import hashlib
import json
import asyncio
from typing import List, Callable, Awaitable

from backend.infrastructure.logging import get_logger

log = get_logger("embedding_cache")

class EmbeddingCache:
    """
    Redis-backed cache for text embeddings.
    Avoids redundant Gemini Embedding API calls for similar/identical text.
    """
    
    def __init__(
        self, 
        redis_client, 
        embed_fn: Callable[[str], Awaitable[List[float]]], 
        ttl_seconds: int = 86400,
        provider_name: str = "unknown"
    ):
        self.redis = redis_client
        self._embed = embed_fn       # async fn(text) -> list[float]
        self.ttl = ttl_seconds
        self._provider_name = provider_name
        
        # Local fallback counters
        self._local_hits = 0
        self._local_misses = 0
    
    def _cache_key(self, text: str) -> str:
        # Normalize: strip + lowercase for better hit rate
        normalized = text.strip().lower()
        hash_val = hashlib.md5(normalized.encode('utf-8')).hexdigest()
        return f"aura:emb:{self._provider_name}:{hash_val}"
    
    async def get_embedding(self, text: str) -> List[float]:
        """Get embedding from cache or compute + cache it."""
        if not text.strip():
            return []

        key = self._cache_key(text)
        
        # 1. Try Cache
        if self.redis:
            try:
                cached = await self.redis.get(key)
                if cached:
                    asyncio.create_task(self._increment_stat("hits"))
                    return json.loads(cached)
            except Exception as e:
                log.debug("embedding_cache_read_failed", error=str(e))
        else:
            # no redis
            pass
        
        # 2. Cache Miss - Call API
        asyncio.create_task(self._increment_stat("misses"))
        embedding = await self._embed(text)
        
        # 3. Cache the result (fire-and-forget)
        if self.redis and embedding:
            try:
                await self.redis.set(
                    key,
                    json.dumps(embedding),
                    ex=self.ttl
                )
            except Exception as e:
                log.debug("embedding_cache_write_failed", error=str(e))
        
        return embedding
        
    async def _increment_stat(self, stat_type: str):
        if self.redis:
            try:
                await self.redis.incr(f"aura:stats:embedding_{stat_type}")
            except Exception:
                pass
        if stat_type == "hits":
            self._local_hits += 1
        else:
            self._local_misses += 1
    
    async def get_stats(self) -> dict:
        hits = self._local_hits
        misses = self._local_misses
        
        if self.redis:
            try:
                r_hits = await self.redis.get("aura:stats:embedding_hits")
                r_misses = await self.redis.get("aura:stats:embedding_misses")
                if r_hits is not None: hits = int(r_hits)
                if r_misses is not None: misses = int(r_misses)
            except Exception:
                pass
                
        total = hits + misses
        hit_rate = hits / total if total > 0 else 0.0
        
        return {
            'hits': hits,
            'misses': misses,
            'hit_rate': f"{hit_rate:.1%}",
        }
