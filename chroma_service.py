import asyncio
from datetime import datetime
import os
from google import genai

class ChromaBackgroundService:
    def __init__(self):
        self.supabase_client = None
        self.genai_client = None
        self.is_ready = False

    async def initialize(self, supabase_client=None, rebuild_user_id=None):
        try:
            self.supabase_client = supabase_client
            # Configure Gemini for embeddings
            self.genai_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
            
            # Warm up not strictly necessary for Supabase, but we mark ready
            self.is_ready = True
            print("[AURA] Supabase pgvector warm and ready")
        except Exception as e:
            print(f"[AURA] Supabase pgvector unavailable: {e}")
            self.is_ready = False

    async def query(self, text: str, n: int = 3) -> list:
        if not self.is_ready or not self.supabase_client or not self.genai_client:
            return []
        try:
            loop = asyncio.get_event_loop()
            
            def get_embedding():
                response = self.genai_client.models.embed_content(
                    model="text-embedding-004",
                    contents=text
                )
                return response.embeddings[0].values

            query_emb = await loop.run_in_executor(None, get_embedding)

            def call_rpc():
                return self.supabase_client.rpc(
                    "match_memories",
                    {
                        "query_embedding": list(query_emb),
                        "match_user_id": None,
                        "match_threshold": 0.0,
                        "match_count": n
                    }
                ).execute()

            response = await loop.run_in_executor(None, call_rpc)

            results = []
            if response and hasattr(response, "data") and response.data:
                for row in response.data:
                    results.append({
                        "text": row.get("turn_text", ""),
                        "metadata": row.get("metadata", {})
                    })
            return results
        except Exception as e:
            print(f"[AURA] Query error: {e}")
            return []

    async def store_memory(
        self,
        session_id: str,
        text: str,
        metadata: dict,
        embedding_id: str
    ):
        if not self.is_ready or not self.supabase_client or not self.genai_client:
            return
        try:
            loop = asyncio.get_event_loop()
            
            def get_embedding():
                response = self.genai_client.models.embed_content(
                    model="text-embedding-004",
                    contents=text
                )
                return response.embeddings[0].values
                
            emb = await loop.run_in_executor(None, get_embedding)
            
            user_id = metadata.get("user_id", "")
            
            def insert_record():
                self.supabase_client.table("aura_chroma_backup").upsert({
                    "user_id": user_id,
                    "session_id": session_id,
                    "turn_text": text,
                    "metadata": metadata,
                    "embedding_id": embedding_id,
                    "embedding": list(emb),
                    "created_at": datetime.utcnow().isoformat()
                }).execute()
            
            await loop.run_in_executor(None, insert_record)
        except Exception as e:
            print(f"[AURA] Store error: {e}")
            pass


    async def rebuild_from_supabase(
        self, supabase_client, user_id: str
    ):
        # Not needed since Supabase is now the primary DB
        pass

chroma_service = ChromaBackgroundService()
