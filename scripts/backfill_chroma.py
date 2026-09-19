import os
import sys
import asyncio
from dotenv import load_dotenv
import requests

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
COHERE_KEY = os.environ.get("COHERE_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY or not COHERE_KEY:
    print("Missing environment variables. Make sure .env is loaded.")
    sys.exit(1)

def get_missing_embeddings():
    url = f"{SUPABASE_URL}/rest/v1/aura_chroma_backup?select=id,content&embedding=is.null"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"Error fetching from Supabase: {response.text}")
        return []
    return response.json()

def generate_embeddings(texts):
    url = "https://api.cohere.ai/v1/embed"
    headers = {
        "Authorization": f"Bearer {COHERE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    data = {
        "texts": texts,
        "model": "embed-english-v3.0",
        "input_type": "search_document"
    }
    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error from Cohere API: {response.text}")
        return []
    return response.json().get("embeddings", [])

def update_embedding(row_id, embedding):
    url = f"{SUPABASE_URL}/rest/v1/aura_chroma_backup?id=eq.{row_id}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    # Supabase pgvector expects string representation like "[0.1, 0.2, ...]"
    data = {
        "embedding": str(embedding)
    }
    response = requests.patch(url, headers=headers, json=data)
    if response.status_code not in [200, 204]:
        print(f"Failed to update row {row_id}: {response.text}")
    return response.status_code == 204

def main():
    print("Fetching rows with missing embeddings...")
    rows = get_missing_embeddings()
    print(f"Found {len(rows)} rows.")
    
    if not rows:
        print("No missing embeddings found. Exiting.")
        return

    batch_size = 90
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        texts = [r['content'] for r in batch if r.get('content')]
        
        if not texts:
            continue
            
        print(f"Generating embeddings for batch {i//batch_size + 1}...")
        embeddings = generate_embeddings(texts)
        
        if len(embeddings) != len(texts):
            print(f"Warning: embedding count mismatch. Expected {len(texts)}, got {len(embeddings)}")
            continue
            
        print(f"Updating {len(batch)} rows in Supabase...")
        success_count = 0
        for idx, row in enumerate(batch):
            if update_embedding(row['id'], embeddings[idx]):
                success_count += 1
                
        print(f"Successfully updated {success_count}/{len(batch)} rows.")
        
if __name__ == "__main__":
    main()
