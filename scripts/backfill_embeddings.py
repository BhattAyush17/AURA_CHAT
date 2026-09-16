import asyncio
import os
import sys
from dotenv import load_dotenv

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, project_root)

load_dotenv(os.path.join(project_root, ".env.local"))
load_dotenv(os.path.join(project_root, ".env"))

_cwd = sys.path.pop(0) if sys.path and (sys.path[0] == '' or sys.path[0] == os.getcwd()) else None
from supabase._async.client import AsyncClient, create_client as async_create_client
if _cwd is not None:
    sys.path.insert(0, _cwd)

from backend.memory.embedding.embedder import embed_text

async def main():
    print("Starting embedding backfill utility...")
    
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)
        
    client = await async_create_client(url, key)
    
    # Fetch rows where embedding is null
    try:
        response = await client.table("aura_chroma_backup").select("id, turn_text, content").is_("embedding", "null").execute()
        rows = getattr(response, "data", [])
    except Exception as e:
        print(f"ERROR: Failed to fetch rows from Supabase: {e}")
        sys.exit(1)
        
    if not rows:
        print("No rows found with NULL embeddings. Backfill complete.")
        sys.exit(0)
        
    print(f"Found {len(rows)} rows with NULL embeddings. Starting backfill...")
    
    success_count = 0
    error_count = 0
    
    for row in rows:
        row_id = row.get("id")
        text = row.get("turn_text") or row.get("content") or ""
        
        if not text.strip():
            print(f"WARNING: Row {row_id} has no text content. Skipping.")
            error_count += 1
            continue
            
        try:
            # Generate embedding
            embed_res = await embed_text(text)
            
            if not embed_res.ok or not embed_res.vector:
                print(f"WARNING: Failed to generate embedding for row {row_id}: {embed_res.detail}")
                error_count += 1
                continue
                
            # Update row in Supabase
            await client.table("aura_chroma_backup").update({"embedding": embed_res.vector}).eq("id", row_id).execute()
            success_count += 1
            if success_count % 50 == 0:
                print(f"Processed {success_count}/{len(rows)} rows...")
                
        except Exception as e:
            print(f"ERROR processing row {row_id}: {e}")
            error_count += 1
            
    print("Backfill complete.")
    print(f"Successfully backfilled: {success_count} rows.")
    if error_count > 0:
        print(f"Failed to backfill: {error_count} rows.")

if __name__ == "__main__":
    asyncio.run(main())
