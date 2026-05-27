"""
AURA Redis Bus — Async message bus for 5-Brain architecture.

Responsibilities:
  1. Lazy async Redis connection with graceful fallback
  2. Publish transcript turns to Redis Stream (aura:transcripts)
  3. Read/write cached analysis results via Redis Hash (hot cache)
  4. Health check for degradation detection
  5. Stream trimming (approximate) to prevent unbounded memory growth
  6. Cache TTL enforcement — stale sessions expire automatically

All operations are non-blocking. If Redis is unavailable,
every public function returns None and the caller falls back
to the existing synchronous path. Zero disruption guarantee.
"""

import os
import json
import time
import asyncio
from typing import Optional, Dict, Any, List
from backend.infrastructure.logging import get_logger

log = get_logger("redis_bus")

import redis.asyncio as aioredis

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STREAM_KEY = "aura:transcripts"
CONSUMER_GROUP = "brain3"
CACHE_PREFIX = "aura:analysis"
CACHE_TTL_SECONDS = 3600   # 1 hour — sessions rarely survive longer on Render free tier

# Stream trimming: approximate mode uses O(1) per XADD instead of
# O(N) exact trim. Redis trims in ~100-entry blocks, so actual
# stream length may briefly exceed this by ~100 entries.
STREAM_MAXLEN = 1000


# ═══════════════════════════════════════════════════════════════════
# CONNECTION MANAGER
# ═══════════════════════════════════════════════════════════════════

class RedisBus:
    """Singleton-style async Redis connection manager."""

    def __init__(self):
        self._client: Optional[aioredis.Redis] = None
        self._available: bool = False
        self._connect_lock = asyncio.Lock()
        self._last_url: Optional[str] = None

    async def initialize(self) -> bool:
        """
        Connect to Redis. Safe to call multiple times.
        Returns True if connected, False if Redis is unreachable.
        """
        current_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        async with self._connect_lock:
            if self._client and self._available and self._last_url == current_url:
                return True

            # If URL changed or previous connection failed, clean up old client
            if self._client and (self._last_url != current_url or not self._available):
                try:
                    await self._client.close()
                except Exception:
                    pass
                self._client = None
                self._available = False

            try:
                self._client = aioredis.from_url(
                    current_url,
                    decode_responses=True,
                    socket_connect_timeout=3,
                    socket_timeout=10,
                    retry_on_timeout=True,
                )
                await self._client.ping()
                self._available = True
                self._last_url = current_url
                log.info("redis_connected", url=current_url)

                # Create consumer group if it doesn't exist
                try:
                    await self._client.xgroup_create(
                        STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True
                    )
                    log.info("consumer_group_created", group=CONSUMER_GROUP)
                except aioredis.ResponseError as e:
                    if "BUSYGROUP" in str(e):
                        pass  # Group already exists — expected on restart
                    else:
                        raise

                return True
            except Exception as e:
                log.warning("redis_connect_failed", url=current_url, error=str(e))
                self._available = False
                self._last_url = current_url
                return False

    @property
    def available(self) -> bool:
        return self._available

    @property
    def client(self) -> Optional[aioredis.Redis]:
        return self._client if self._available else None

    async def health_check(self) -> dict:
        """Return connection health for /health endpoint."""
        if not self._client or not self._available:
            return {"redis": "disconnected", "mode": "DEGRADED"}
        try:
            await self._client.ping()
            return {"redis": "connected", "mode": "FULL"}
        except Exception:
            self._available = False
            return {"redis": "disconnected", "mode": "DEGRADED"}

    async def close(self):
        if self._client:
            await self._client.close()
            self._available = False


# Module-level singleton
redis_bus = RedisBus()


# ═══════════════════════════════════════════════════════════════════
# PUBLISH — Fire-and-forget transcript to stream
# ═══════════════════════════════════════════════════════════════════

async def publish_transcript(
    session_id: str,
    turn_data: Dict[str, Any],
) -> Optional[str]:
    """
    Publish a transcript turn to the Redis Stream.
    Returns the stream message ID, or None if Redis is unavailable.

    turn_data should contain:
      - user_text, session_id, user_id, audio_rms, pause_ms,
        ideology_hint, user_initiated, seed, frustration_score,
        withdrawal_score, language_profile
    """
    client = redis_bus.client
    if not client:
        return None
    try:
        # Serialize the turn as a single JSON field inside the stream entry.
        # Approximate trimming (~) is used because exact trim requires a full
        # radix-tree scan on every XADD. Approximate trims in ~100-entry
        # blocks, keeping the stream near STREAM_MAXLEN without the O(N) cost.
        message_id = await client.xadd(
            STREAM_KEY,
            {
                "session_id": session_id,
                "payload": json.dumps(turn_data, default=str),
            },
            maxlen=STREAM_MAXLEN,
            approximate=True,
        )
        log.info("publish", session_id=session_id)
        return message_id
    except Exception as e:
        log.warning("publish_failed", session_id=session_id, error=str(e))
        return None


# ═══════════════════════════════════════════════════════════════════
# HOT CACHE — Read/write latest analysis result per session
# ═══════════════════════════════════════════════════════════════════

def _cache_key(session_id: str) -> str:
    return f"{CACHE_PREFIX}:{session_id}"


async def write_cached_analysis(
    session_id: str,
    analysis: Dict[str, Any],
) -> bool:
    """
    Write the full analysis result to Redis as a JSON string with TTL.

    WHY TTL: On Render free-tier, the server can crash without running
    session-end cleanup. Without TTL, orphaned cache keys accumulate
    until Redis OOMs. The 1-hour TTL guarantees automatic eviction
    even if expire_session_cache() is never called.

    Caller: behavior_engine_consumer after processing a turn.
    """
    client = redis_bus.client
    if not client:
        return False
    try:
        key = _cache_key(session_id)
        await client.set(key, json.dumps(analysis, default=str), ex=CACHE_TTL_SECONDS)
        log.info("cache_write", session_id=session_id, ttl=CACHE_TTL_SECONDS)
        return True
    except Exception as e:
        log.warning("cache_write_failed", session_id=session_id, error=str(e))
        return False


async def read_cached_analysis(
    session_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Read the latest cached analysis for a session.
    Returns None if no cache exists or Redis is down.
    Caller: server.py /api/analyze endpoint.
    """
    client = redis_bus.client
    if not client:
        return None
    try:
        key = _cache_key(session_id)
        raw = await client.get(key)
        hit = raw is not None
        log.info("cache_read", session_id=session_id, hit=hit)
        if raw:
            return json.loads(raw)
        return None
    except Exception as e:
        log.warning("cache_read_failed", session_id=session_id, error=str(e))
        return None


async def expire_session_cache(session_id: str) -> None:
    """Clean up cache when session ends."""
    client = redis_bus.client
    if not client:
        return
    try:
        await client.delete(_cache_key(session_id))
    except Exception:
        pass


async def get_cached_memories(session_id: str) -> str:
    """
    Extract just the memory enrichment string from the cached analysis.

    WHY a separate helper: Some callers (e.g., speculative pre-fetch
    or debug endpoints) only need the memory enrichment, not the full
    analysis dict. This avoids parsing the entire JSON just to check
    if memories exist.

    Returns empty string if cache is cold, Redis is down, or the cached
    result was written before memory retrieval was added to the worker
    (backward compatibility).
    """
    cached = await read_cached_analysis(session_id)
    if cached:
        return cached.get("memory_enrichment", "")
    return ""


# ═══════════════════════════════════════════════════════════════════
# UTILITIES — Stream & cache diagnostics
# ═══════════════════════════════════════════════════════════════════

async def get_stream_length() -> Optional[int]:
    """
    Return the current length of the aura:transcripts stream.

    WHY: Monitoring. If XLEN consistently exceeds STREAM_MAXLEN by
    more than ~200 entries, approximate trimming is not keeping up
    and the consumer is lagging behind the publisher. Surface this
    in /health so ops can detect backpressure before Redis OOMs.
    """
    client = redis_bus.client
    if not client:
        return None
    try:
        return await client.xlen(STREAM_KEY)
    except Exception as e:
        log.warning("xlen_failed", error=str(e))
        return None


async def cleanup_stale_sessions(max_age_seconds: int = 7200) -> Dict[str, Any]:
    """
    Scan all aura:analysis:* cache keys and report TTL status.

    WHY: Diagnostic tool — not called in the hot path. Use this
    from a periodic health check or manual /debug endpoint to
    verify that TTLs are being enforced correctly and no orphaned
    keys are accumulating without expiration.

    Args:
        max_age_seconds: Keys with TTL remaining below
            (CACHE_TTL_SECONDS - max_age_seconds) are considered
            "stale" (i.e., they were written more than max_age_seconds ago).

    Returns:
        Dict with counts of active, expiring, and no-ttl keys.
    """
    client = redis_bus.client
    if not client:
        return {"error": "redis_unavailable"}

    active: int = 0
    expiring: int = 0
    no_ttl: int = 0
    keys_scanned: int = 0

    try:
        # SCAN is non-blocking and cursor-based — safe for production.
        # KEYS would block the event loop on large keyspaces.
        cursor: str = "0"
        while True:
            cursor, keys = await client.scan(
                cursor=cursor,
                match=f"{CACHE_PREFIX}:*",
                count=100,
            )
            # Use a pipeline to fetch TTLs for all keys in this batch in one round trip
            pipe = client.pipeline()
            for key in keys:
                pipe.ttl(key)
            ttls = await pipe.execute()

            for i, key in enumerate(keys):
                keys_scanned += 1
                ttl = ttls[i]
                if ttl == -1:
                    # Key exists but has no expiry — this is a bug.
                    # Set a TTL retroactively to prevent orphan buildup.
                    await client.expire(key, CACHE_TTL_SECONDS)
                    no_ttl += 1
                elif ttl == -2:
                    pass  # Key expired between SCAN and TTL — ignore
                elif ttl < (CACHE_TTL_SECONDS - max_age_seconds):
                    expiring += 1
                else:
                    active += 1

            if cursor == "0" or cursor == 0:
                break

        result = {
            "keys_scanned": keys_scanned,
            "active": active,
            "expiring_soon": expiring,
            "missing_ttl_fixed": no_ttl,
        }
        log.info("cleanup_scan", **result)
        return result

    except Exception as e:
        log.warning("cleanup_scan_failed", error=str(e))
        return {"error": str(e)}
