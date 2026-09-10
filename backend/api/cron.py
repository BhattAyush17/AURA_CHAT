import os
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader

from backend.memory.consolidator import MemoryConsolidator
from backend.infrastructure.embedding_provider import embedding_provider
from backend.infrastructure.logging import get_logger
# Resolve the shared Supabase client at request time. A plain
# `from backend.api.main import supabase` captures the import-time value
# (None) — the client is only created in main's startup_event.
from backend.api.main import get_supabase

log = get_logger("cron_endpoint")
router = APIRouter()

# Vercel sends the cron secret as a Bearer token
api_key_header = APIKeyHeader(name="Authorization", auto_error=False)

def verify_cron_secret(auth_header: str = Security(api_key_header)):
    """Validates that the request is actually coming from Vercel Cron."""
    cron_secret = os.environ.get("CRON_SECRET")
    if not cron_secret:
        log.error("cron_secret_missing_in_env")
        raise HTTPException(status_code=500, detail="Server configuration error")
    
    expected_token = f"Bearer {cron_secret}"
    if not auth_header or auth_header != expected_token:
        log.warning("unauthorized_cron_attempt")
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

@router.get("/api/cron/consolidate", dependencies=[Depends(verify_cron_secret)])
async def execute_memory_consolidation():
    """
    Scans the database for old, raw turns and compresses them into episode summaries.
    """
    log.info("starting_scheduled_consolidation")

    supabase = get_supabase()
    if not supabase:
        log.error("cron_consolidation_no_supabase")
        raise HTTPException(status_code=503, detail="Supabase client unavailable")

    # 1. Initialize the consolidator with the multi-tier embedding provider
    consolidator = MemoryConsolidator(supabase, embedding_provider.embed)
    
    try:
        # 2. Fetch distinct users who have unconsolidated memories
        # Optimization: Only fetch users active in the last week who need compression
        try:
            user_response = await supabase.table("aura_chroma_backup") \
                .select("user_id") \
                .is_("consolidated_at", "null") \
                .execute()
        except Exception as e:
            log.error("consolidator_run_consolidation_failed", detail="consolidated_at column missing", error=str(e))
            return {"status": "error", "message": "Schema missing consolidated_at column."}
            
        if not user_response.data:
            return {"status": "success", "message": "No memories require consolidation."}
            
        # Get unique user IDs
        unique_users = list(set([row["user_id"] for row in user_response.data if row.get("user_id")]))
        
        results = []
        # 3. Process each user sequentially to avoid hammering the LLM/Embedding API limits
        for user_id in unique_users:
            stats = await consolidator.consolidate_user(user_id=user_id, dry_run=False)
            results.append(stats)
            
        # 4. Purge rows that were soft-deleted over 30 days ago
        purged_count = await consolidator.purge_old_memories(days=30)

        # Surface per-user failures explicitly instead of folding them into a
        # clean 200. The response still lands 200 (cron cycle completed) but the
        # telemetry makes the error state observable.
        err_count = sum((s.get("errors", 0) for s in results if isinstance(s, dict)))
        if err_count:
            log.warning("cron_consolidation_had_errors", errors=err_count)

        return {
            "status": "success",
            "users_processed": len(unique_users),
            "consolidation_stats": results,
            "purged_records": purged_count
        }

    except Exception as e:
        log.error("cron_consolidation_failed", error=str(e))
        raise HTTPException(status_code=500, detail="Consolidation pipeline failed")
