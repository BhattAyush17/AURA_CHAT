import asyncio
import re
from datetime import datetime
import os
from backend.infrastructure.logging import get_logger
from backend.infrastructure.embedding_provider import embedding_provider

log = get_logger("chroma_service")

# Configurable recency weight for hybrid memory retrieval
RECENCY_WEIGHT = float(os.getenv("MEMORY_RECENCY_WEIGHT", "0.15"))


# ─── FTS Helpers ─────────────────────────────────────────────────

_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "to", "of", "in", "for", "on",
    "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "out", "off",
    "over", "under", "again", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "both", "each", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "because", "but", "and", "or",
    "if", "while", "about", "up", "what", "which", "who", "whom",
    "this", "that", "these", "those", "am", "it", "its", "my", "me",
    "we", "our", "you", "your", "he", "him", "she", "her", "they",
    "them", "i",
    # Hindi / Hinglish stopwords
    "mujhe", "hai", "hain", "ka", "ki", "ke", "ko", "se", "ne", "par",
    "ye", "wo", "kya", "aur", "ya", "nahi", "ho", "tha", "thi", "bhi",
    "mein", "hum", "tum", "aap", "yeh", "woh", "kab", "kaise",
})


def _extract_keywords(text: str, max_keywords: int = 6) -> list:
    """Extract significant keywords from text for FTS matching.
    Handles English, Hindi, and Hinglish by stripping stopwords
    and keeping words with 3+ characters."""
    words = re.findall(r'\w+', text.lower())
    keywords = [
        w for w in words
        if len(w) >= 3 and w not in _STOP_WORDS and not w.isdigit()
    ]
    seen = set()
    unique = []
    for k in keywords:
        if k not in seen:
            seen.add(k)
            unique.append(k)
    return unique[:max_keywords]


class ChromaBackgroundService:
    def __init__(self):
        self.supabase_client = None
        self.is_ready = False

    async def initialize(self, supabase_client=None, rebuild_user_id=None):
        self.supabase_client = supabase_client

        # Initialize the multi-tier embedding provider
        provider_name = await embedding_provider.initialize()

        # Mark ready if Supabase is available (FTS works even without embeddings)
        if self.supabase_client:
            self.is_ready = True
            if embedding_provider.is_available:
                print(f"[AURA] Memory ready — {provider_name} embeddings + pgvector")
            else:
                print("[AURA] Memory active — FTS keyword fallback (no embedding provider)")
        else:
            self.is_ready = False
            print("[AURA] Supabase unavailable — memory disabled")

    # ─── Vector query (original, backward compatible) ────────────

    async def query(self, text: str, n: int = 3, embedding_cache=None) -> list:
        """Original query method — backward compatible. Uses match_memories v1."""
        if not self.is_ready or not self.supabase_client:
            return []

        if not embedding_provider.is_available:
            return await self._query_fts(text, user_id=None, n=n)

        try:
            if embedding_cache:
                query_emb = await embedding_cache.get_embedding(text)
            else:
                query_emb = await embedding_provider.embed(text)

            if not query_emb:
                return await self._query_fts(text, user_id=None, n=n)

            response = await self.supabase_client.rpc(
                "match_memories",
                {
                    "query_embedding": list(query_emb),
                    "match_user_id": None,
                    "match_threshold": 0.0,
                    "match_count": n
                }
            ).execute()
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

    # ─── Hybrid vector query v2 ──────────────────────────────────

    async def query_memories_v2(
        self,
        text: str,
        user_id: str,
        n: int = 3,
        threshold: float = 0.65,
        max_age_days: int = 365,
        embedding_cache=None
    ) -> list:
        """
        Hybrid memory retrieval: semantic similarity + temporal recency.
        Uses match_memories_v2 RPC for weighted scoring.
        Falls back to FTS keyword search when embeddings unavailable.
        """
        if not self.is_ready or not self.supabase_client:
            return []

        if not embedding_provider.is_available:
            return await self._query_fts(text, user_id=user_id, n=n, max_age_days=max_age_days)

        try:
            if embedding_cache:
                query_emb = await embedding_cache.get_embedding(text)
            else:
                query_emb = await embedding_provider.embed(text)

            if not query_emb:
                return await self._query_fts(text, user_id=user_id, n=n, max_age_days=max_age_days)

            response = await self.supabase_client.rpc(
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
            if "function does not exist" in err_msg:
                log.error("rpc_missing", error=str(e), rpc="match_memories_v2")
            else:
                log.warning("memory_query_failed", error=str(e), method="v2")
            return []

    # ─── FTS Keyword Search Fallback ─────────────────────────────

    async def _query_fts(self, text, user_id=None, n=3, max_age_days=365):
        """Keyword matching fallback when no embedding provider is available."""
        if not self.supabase_client:
            return []

        keywords = _extract_keywords(text)
        if not keywords:
            return []

        try:
            or_clauses = ",".join([f"turn_text.ilike.%{kw}%" for kw in keywords])

            q = (
                self.supabase_client.table("aura_chroma_backup")
                .select("turn_text, metadata, created_at")
            )
            if user_id:
                q = q.eq("user_id", user_id)
            q = q.or_(or_clauses).order("created_at", desc=True).limit(n * 2)
            response = await q.execute()
            results = []
            now = datetime.utcnow()

            if response and hasattr(response, "data") and response.data:
                for row in response.data:
                    created = row.get("created_at", "")
                    age_hours = 0.0
                    if created:
                        try:
                            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                            age_hours = (now - dt.replace(tzinfo=None)).total_seconds() / 3600
                        except Exception:
                            pass

                    if age_hours > max_age_days * 24:
                        continue

                    turn_lower = (row.get("turn_text", "") or "").lower()
                    hits = sum(1 for kw in keywords if kw in turn_lower)
                    keyword_score = round(hits / len(keywords), 3)
                    recency = round(max(0.0, 1.0 - (age_hours / (max_age_days * 24))), 3)

                    results.append({
                        "text": row.get("turn_text", ""),
                        "metadata": row.get("metadata", {}),
                        "similarity": keyword_score,
                        "recency_score": recency,
                        "final_score": round(keyword_score * 0.7 + recency * 0.3, 3),
                        "age_hours": round(age_hours, 1),
                        "recency_label": _age_to_label(age_hours),
                    })

            results.sort(key=lambda r: r["final_score"], reverse=True)
            log.info("memory_fts_query", keywords=keywords, result_count=len(results[:n]))
            return results[:n]

        except Exception as e:
            log.warning("memory_fts_failed", error=str(e))
            return []

    # ─── Memory formatting ───────────────────────────────────────

    def format_memories_for_injection(self, memories: list) -> str:
        """Format query results into prompt-injectable memory context."""
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

    # ─── Store memory ────────────────────────────────────────────

    async def store_memory(self, session_id, text, metadata, embedding_id, embedding_cache=None):
        if not self.is_ready or not self.supabase_client:
            return
        try:
            emb = None
            if embedding_provider.is_available:
                if embedding_cache:
                    emb = await embedding_cache.get_embedding(text)
                else:
                    emb = await embedding_provider.embed(text)

            record = {
                "user_id": metadata.get("user_id", ""),
                "session_id": session_id,
                "turn_text": text,
                "metadata": metadata,
                "embedding_id": embedding_id,
                "created_at": datetime.utcnow().isoformat(),
            }
            if emb:
                record["embedding"] = list(emb)

            await self.supabase_client.table("aura_chroma_backup").upsert(record).execute()
            log.info("memory_stored", mode="vector" if emb else "text_only")
        except Exception as e:
            log.warning("memory_store_failed", error=str(e))

    async def rebuild_from_supabase(self, supabase_client, user_id: str):
        # Not needed since Supabase is now the primary DB
        pass

chroma_service = ChromaBackgroundService()


# ─── Helpers ─────────────────────────────────────────────────────

def _age_to_label(age_hours: float) -> str:
    """Convert age in hours to a human-readable temporal label."""
    if age_hours < 24:
        return "Earlier today"
    if age_hours < 168:
        return "A few days ago"
    if age_hours < 720:
        return "A few weeks ago"
    return "A while back"
