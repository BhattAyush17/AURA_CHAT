import asyncio
import os
import sys

from supabase import create_client

from backend.infrastructure.embedding_provider import embedding_provider


async def main():
    print("Starting embedding backfill utility...")
    
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL and SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)
        
    client = create_client(supabase_url, supabase_key)
    
    # Initialize the embedding provider (Gemini/Cohere/Fastembed)
    await embedding_provider.initialize()
    if not embedding_provider.is_available:
        print("ERROR: No embedding provider available.")
        sys.exit(1)
        
    print(f"Embedding provider initialized: {embedding_provider.provider_name}")
    
    # Fetch rows where embedding is null
    try:
        response = client.table("aura_chroma_backup").select("id, turn_text").is_("embedding", "null").execute()
        rows = response.data
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
        text = row.get("turn_text")
        
        if not text:
            print(f"WARNING: Row {row_id} has no turn_text. Skipping.")
            error_count += 1
            continue
            
        try:
            # Generate embedding
            embedding = await embedding_provider.embed(text)
            
            if not embedding:
                print(f"WARNING: Failed to generate embedding for row {row_id}.")
                error_count += 1
                continue
                
            # Update row in Supabase
            client.table("aura_chroma_backup").update({"embedding": embedding}).eq("id", row_id).execute()
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
