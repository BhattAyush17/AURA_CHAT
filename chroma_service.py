import asyncio
from datetime import datetime
import os
from google import genai
from logging_config import get_logger

log = get_logger("chroma_service")

# Configurable recency weight for hybrid memory retrieval
RECENCY_WEIGHT = float(os.getenv("MEMORY_RECENCY_WEIGHT", "0.15"))


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

    async def query(self, text: str, n: int = 3, embedding_cache=None) -> list:
        """Original query method — backward compatible. Uses match_memories v1."""
        if not self.is_ready or not self.supabase_client or not self.genai_client:
            return []
        try:
            if embedding_cache:
                query_emb = await embedding_cache.get_embedding(text)
            else:
                def get_embedding():
                    response = self.genai_client.models.embed_content(
                        model="gemini-embedding-001",
                        contents=[text],
                        config={"output_dimensionality": 768}
                    )
                    return response.embeddings[0].values

                query_emb = await asyncio.to_thread(get_embedding)

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

            response = await asyncio.to_thread(call_rpc)

            results = []
            if response and hasattr(response, "data") and response.data:
                for row in response.data:
                    results.append({
                        "text": row.get("turn_text", ""),
                        "metadata": row.get("metadata", {})
                    })
            return results
        except Exception as e:
            log.warning("memory_query_failed", error=str(e), method="v1")
            return []

    async def query_memories_v2(
        self,
        text: str,
        user_id: str,
        n: int = 3,
        threshold: float = 0.65,
        max_age_days: int = 365,
        embedding_cache = None
    ) -> list:
        """
        Hybrid memory retrieval: semantic similarity + temporal recency.
        Uses match_memories_v2 RPC for weighted scoring.

        Returns list of dicts with:
          text, metadata, similarity, recency_score, final_score, age_hours, recency_label
        """
        if not self.is_ready or not self.supabase_client or not self.genai_client:
            return []
        try:
            if embedding_cache:
                query_emb = await embedding_cache.get_embedding(text)
            else:
                def get_embedding():
                    response = self.genai_client.models.embed_content(
                        model="gemini-embedding-001",
                        contents=[text],
                        config={"output_dimensionality": 768}
                    )
                    return response.embeddings[0].values

                query_emb = await asyncio.to_thread(get_embedding)

            def call_rpc():
                return self.supabase_client.rpc(
                    "match_memories_v2",
                    {
                        "query_embedding": list(query_emb),
                        "p_user_id": user_id,
                        "match_threshold": threshold,
                        "match_count": n,
                        "recency_weight": RECENCY_WEIGHT,
                        "max_age_days": max_age_days,
                    },
                ).execute()

            response = await asyncio.to_thread(call_rpc)

            results = []
            if response and hasattr(response, "data") and response.data:
                for row in response.data:
                    age_hours = row.get("age_hours", 0.0)
                    results.append({
                        "text": row.get("turn_text", ""),
                        "metadata": row.get("metadata", {}),
                        "similarity": round(row.get("similarity", 0.0), 3),
                        "recency_score": round(row.get("recency_score", 0.0), 3),
                        "final_score": round(row.get("final_score", 0.0), 3),
                        "age_hours": round(age_hours, 1),
                        "recency_label": _age_to_label(age_hours),
                    })
            return results
        except Exception as e:
            err_msg = str(e).lower()
            if "relation does not exist" in err_msg or "function does not exist" in err_msg:
                log.error("rpc_missing", error=str(e), rpc="match_memories_v2")
            else:
                log.warning("memory_query_failed", error=str(e), method="v2")
            return []

    def format_memories_for_injection(self, memories: list) -> str:
        """
        Format v2 query results into natural-language memory context
        with temporal labels for prompt injection.
        """
        if not memories:
            return ""

        lines = []
        for mem in memories:
            label = mem.get("recency_label", "")
            text = mem.get("text", "").strip()
            if not text:
                continue
            if label:
                lines.append(f"[{label}] you mentioned: \"{text}\"")
            else:
                lines.append(f"You mentioned: \"{text}\"")

        if not lines:
            return ""

        return "[MEMORY CONTEXT]\n" + "\n".join(lines) + "\n[/MEMORY CONTEXT]"

    async def store_memory(
        self,
        session_id: str,
        text: str,
        metadata: dict,
        embedding_id: str,
        embedding_cache = None
    ):
        if not self.is_ready or not self.supabase_client or not self.genai_client:
            return
        try:
            if embedding_cache:
                emb = await embedding_cache.get_embedding(text)
            else:
                def get_embedding():
                    response = self.genai_client.models.embed_content(
                        model="gemini-embedding-001",
                        contents=[text],
                        config={"output_dimensionality": 768}
                    )
                    return response.embeddings[0].values
                    
                emb = await asyncio.to_thread(get_embedding)
            
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
            
            await asyncio.to_thread(insert_record)
        except Exception as e:
            log.warning("memory_store_failed", error=str(e))


    async def rebuild_from_supabase(
        self, supabase_client, user_id: str
    ):
        # Not needed since Supabase is now the primary DB
        pass

chroma_service = ChromaBackgroundService()


# ─── Helpers ─────────────────────────────────────────────────────

def _age_to_label(age_hours: float) -> str:
    """Convert age in hours to a human-readable temporal label."""
    if age_hours < 24:
        return "Earlier today"
    if age_hours < 168:  # 7 days
        return "A few days ago"
    if age_hours < 720:  # 30 days
        return "A few weeks ago"
    return "A while back"
