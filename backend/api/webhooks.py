from fastapi import APIRouter, Request
from backend.core.pipeline import run_turn_pipeline

router = APIRouter()

@router.post("/api/webhooks/process_memory")
async def process_memory_webhook(payload: dict):
    # Dynamic import to avoid circular dependency with main.py
    from backend.api.main import engine
    
    # This runs completely independently of the user's request.
    # Vercel gives this endpoint its own timeout and execution context.
    # Connection pooling (e.g., Supabase PgBouncer) handles the load safely.
    
    await run_turn_pipeline(
        engine=engine,
        user_text=payload.get("user_text"),
        session_id=payload.get("session_id"),
        user_id=payload.get("user_id", "anonymous"),
        ideology_hint=payload.get("ideology_hint"),
        user_initiated=payload.get("user_initiated", True),
        audio_rms=payload.get("audio_rms", 0.04),
        pause_ms=payload.get("pause_ms", 500),
        turn_history=payload.get("turn_history", []),
        seed=payload.get("seed", ""),
        memory_timeout=2.0
    )
    return {"status": "processed"}
