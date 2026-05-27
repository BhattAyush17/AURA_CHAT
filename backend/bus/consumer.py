"""
AURA Brain 3 — Async Behavior Engine Consumer

Subscribes to the Redis "aura:transcripts" stream and runs
the existing RuntimeEngine analysis pipeline off the main
request path. Results are written to Redis hot-cache so
server.py can read them non-blockingly.

Design:
  - Uses XREADGROUP for reliable at-least-once delivery
  - Processes one completed turn per message (not chunks)
  - Writes full AnalyzeResponse-equivalent dict to cache
  - ACKs each message after successful processing
  - Heartbeat key with 30s TTL — auto-expires if consumer dies
  - Lag detection every 10 messages — warns if falling behind
  - Graceful shutdown on SIGTERM/SIGINT and asyncio cancellation

This file does NOT modify any analysis logic. It only changes
WHERE the analysis runs (background coroutine instead of
inline in the request handler).
"""

import json
import time
import signal
import asyncio
import traceback
from typing import Optional
from backend.infrastructure.logging import setup_logging, get_logger

import redis.asyncio as aioredis
import os

from backend.bus.redis import (
    redis_bus,
    STREAM_KEY,
    CONSUMER_GROUP,
    write_cached_analysis,
)
from backend.personality.toxicity_engine import process_toxicity_pipeline
from backend.core.behavior import (
    RuntimeEngine,
    build_sensing_injection,
    detect_language_profile,
    get_sensing_engine,
)
from backend.memory.sync import get_chromadb_enrichment, get_chromadb_enrichment_v2
from backend.core.vocab import VocabLearner, set_vocab_learner_clients
from backend.core.relationship import RelationshipTracker
from backend.infrastructure.embedding_cache import EmbeddingCache
from backend.core.intelligence import composer
from backend.infrastructure.embedding_provider import embedding_provider

# ─── Per-user VocabLearner cache ──────────────────────────────────────────────
# Each user gets their own VocabLearner instance (loaded from Redis/Supabase).
# Evict entries idle for > 30 minutes to bound memory.

_VOCAB_CACHE_TTL = 1800  # 30 minutes in seconds
_VOCAB_CACHE_MAX = 200   # Hard cap — evict oldest when exceeded (prevents OOM under burst)

class _VocabCache:
    """
    Per-user VocabLearner cache with dual-mode eviction:
      1. Size cap: LRU eviction when > _VOCAB_CACHE_MAX entries.
      2. TTL eviction: entries idle > _VOCAB_CACHE_TTL seconds are reaped
         every EVICT_EVERY_N processed messages.

    Using a plain dict here (insertion-order preserved in Python 3.7+)
    lets us do O(1) LRU via move-to-end pattern identical to behavior.py.
    """
    def __init__(self):
        # user_id → (learner, last_used_ts); insertion order = LRU order
        self._cache: dict[str, tuple[VocabLearner, float]] = {}

    def get(self, user_id: str, redis_client=None, supabase_client=None) -> VocabLearner:
        entry = self._cache.pop(user_id, None)
        if entry is None:
            if supabase_client is None:
                try:
                    from backend.api.main import supabase as _supabase_client
                    supabase_client = _supabase_client
                except Exception:
                    pass
            learner = VocabLearner(redis_client=redis_client, supabase_client=supabase_client)
        else:
            learner, _ = entry

        # Re-insert at end (most-recently-used position)
        self._cache[user_id] = (learner, time.monotonic())

        # Enforce hard size cap — evict the least-recently-used entry
        while len(self._cache) > _VOCAB_CACHE_MAX:
            self._cache.pop(next(iter(self._cache)))

        return learner

    def evict_stale(self):
        now = time.monotonic()
        stale = [uid for uid, (_, ts) in self._cache.items() if now - ts > _VOCAB_CACHE_TTL]
        for uid in stale:
            del self._cache[uid]

_vocab_cache = _VocabCache()



# ═══════════════════════════════════════════════════════════════════
# LOGGING
# ═══════════════════════════════════════════════════════════════════

log = get_logger("consumer")


# ═══════════════════════════════════════════════════════════════════
# CONSUMER CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

CONSUMER_NAME = "brain3-worker-0"
BLOCK_MS = 2000        # Block for 2s waiting for new messages
BATCH_SIZE = 10        # Process up to 10 messages per read
HEARTBEAT_KEY = "aura:consumer:heartbeat"
HEARTBEAT_TTL = 30     # Seconds — if consumer dies, key expires in 30s
LAG_CHECK_INTERVAL = 10  # Check lag every N processed messages
LAG_WARN_THRESHOLD = 10  # Log WARNING if pending > this
LAG_CRIT_THRESHOLD = 50  # Log CRITICAL + drain if pending > this
MEMORY_TIMEOUT_SECONDS = 0.5  # Max time to wait for pgvector retrieval per turn

# Module-level relationship tracker (initialized lazily with Redis client)
_rel_tracker: Optional[RelationshipTracker] = None

# Graceful shutdown event — set by SIGTERM/SIGINT handler
_shutdown_event: Optional[asyncio.Event] = None

# Stale cache eviction counter
_evict_counter: int = 0
EVICT_EVERY_N = 50  # Evict stale VocabLearner entries every N processed messages

# ─── Embedding Cache ──────────────────────────────────────────────────────────
# Uses the multi-tier embedding_provider (Gemini → Cohere → FastEmbed → None)
embedding_cache: Optional[EmbeddingCache] = None


# ═══════════════════════════════════════════════════════════════════
# HEARTBEAT & LAG MONITORING
# ═══════════════════════════════════════════════════════════════════

async def _write_heartbeat(client: aioredis.Redis) -> None:
    """
    Fire-and-forget heartbeat write.

    WHY 30s TTL: If the consumer process crashes or hangs, the
    heartbeat key silently expires. The /health endpoint can
    check for its existence to detect a dead consumer without
    polling or process monitoring.
    """
    try:
        await client.set(
            HEARTBEAT_KEY,
            str(time.time()),
            ex=HEARTBEAT_TTL,
        )
    except Exception:
        pass  # Non-critical — never block processing for a heartbeat


async def _check_consumer_lag(client: aioredis.Redis) -> int:
    """
    Query XINFO GROUPS to get the consumer group's pending count.

    Returns the lag (pending message count), or 0 on failure.
    The 'lag' field was added in Redis 7.0. For older versions,
    we fall back to 'pending' which is always available.
    """
    try:
        groups = await client.xinfo_groups(STREAM_KEY)
        for group in groups:
            if group.get("name") == CONSUMER_GROUP:
                # Redis 7+ exposes 'lag' directly; older versions don't
                lag = group.get("lag", group.get("pending", 0))
                return int(lag)
    except Exception as e:
        log.debug("lag_check_failed", error=str(e))
    return 0


# ═══════════════════════════════════════════════════════════════════
# CONSUMER LOOP
# ═══════════════════════════════════════════════════════════════════

async def run_behavior_consumer(engine: RuntimeEngine) -> None:
    """
    Long-running coroutine that consumes transcript events
    from Redis Streams and runs the behavior analysis pipeline.

    Args:
        engine: The existing RuntimeEngine instance from server.py.
                Shared reference — same in-memory state as the
                synchronous fallback path.
    """
    global _shutdown_event
    _shutdown_event = asyncio.Event()

    # Register SIGTERM/SIGINT for graceful shutdown.
    # In asyncio context, loop.add_signal_handler is the safe way
    # to bridge OS signals into the coroutine world.
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _shutdown_event.set)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler — fall back to
            # asyncio.CancelledError from the task cancellation path.
            pass

    log.info("consumer_started", group=CONSUMER_GROUP, consumer=CONSUMER_NAME)

    # Wait for Redis to be available
    if not redis_bus.available:
        connected = await redis_bus.initialize()
        if not connected:
            log.warning("consumer_abort", reason="redis_unavailable")
            return

    client = redis_bus.client
    if not client:
        log.error("consumer_abort", reason="no_redis_client")
        return

    # Inject Redis + Supabase clients into global singleton and cache factory
    # P8 FIX: Previously only Redis was passed — Supabase saves were no-ops
    from backend.api.main import supabase as _supabase_client
    set_vocab_learner_clients(redis_client=client, supabase_client=_supabase_client)

    # Initialize Embedding Cache (uses multi-tier provider)
    global embedding_cache
    embedding_cache = EmbeddingCache(
        redis_client=client,
        embed_fn=embedding_provider.embed,
        provider_name=embedding_provider.provider_name,
    )

    log.info("consumer_listening", stream=STREAM_KEY, consumer=CONSUMER_NAME)

    processed_count: int = 0

    while not _shutdown_event.is_set():
        try:
            # XREADGROUP: read new messages for this consumer
            messages = await client.xreadgroup(
                CONSUMER_GROUP,
                CONSUMER_NAME,
                {STREAM_KEY: ">"},     # ">" = only new, undelivered messages
                count=BATCH_SIZE,
                block=BLOCK_MS,
            )

            if not messages:
                continue  # Timeout, no new messages — loop back

            # messages format: [(stream_name, [(msg_id, {fields}), ...])]
            for stream_name, entries in messages:
                for msg_id, fields in entries:
                    try:
                        await _process_turn(engine, fields, client)
                        processed_count += 1

                        # ── Heartbeat: fire-and-forget after every successful turn ──
                        asyncio.create_task(_write_heartbeat(client))

                        # ── Lag check: every N messages ──
                        if processed_count % LAG_CHECK_INTERVAL == 0:
                            lag = await _check_consumer_lag(client)
                            if lag > LAG_CRIT_THRESHOLD:
                                log.critical("consumer_lag", lag_count=lag, processed=processed_count, severity="critical")
                            elif lag > LAG_WARN_THRESHOLD:
                                log.warning("consumer_lag", lag_count=lag, processed=processed_count)

                        # ── VocabLearner stale cache eviction ──
                        global _evict_counter
                        _evict_counter += 1
                        if _evict_counter % EVICT_EVERY_N == 0:
                            _vocab_cache.evict_stale()

                    except Exception as e:
                        log.error("consumer_error", error=str(e), msg_id=str(msg_id))
                    finally:
                        # ACK regardless — don't reprocess broken messages forever
                        await client.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)

        except asyncio.CancelledError:
            log.info("consumer_shutdown", reason="cancelled")
            break
        except aioredis.ConnectionError:
            log.warning("consumer_reconnect", reason="connection_lost")
            await asyncio.sleep(5)
            # Try to reconnect
            await redis_bus.initialize()
            client = redis_bus.client
            if not client:
                log.error("consumer_abort", reason="reconnect_failed")
                break
        except Exception as e:
            # Never let an unexpected error kill the consumer permanently.
            # Log the full traceback, sleep briefly, and continue.
            log.error("consumer_error", error=str(e), traceback=traceback.format_exc())
            await asyncio.sleep(1)

    # ── Graceful shutdown cleanup ──
    log.info("consumer_shutdown", processed_total=processed_count)
    await redis_bus.close()


# ═══════════════════════════════════════════════════════════════════
# TURN PROCESSOR — Calls existing analysis pipeline
# ═══════════════════════════════════════════════════════════════════


async def _process_turn(engine: RuntimeEngine, fields: dict, redis_client=None) -> None:
    """
    Process a single transcript turn through the shared core pipeline.
    Writes result to Redis hot-cache for the next /api/analyze response.

    All heavy lifting is delegated to backend.core.pipeline.run_turn_pipeline()
    which is also used by the main.py sync fallback — eliminating the prior
    DRY violation (see docs/architecture/prioritized_fixes.md P2 #9).
    """
    from backend.core.pipeline import run_turn_pipeline

    session_id = fields.get("session_id", "")
    payload_raw = fields.get("payload", "{}")
    payload = json.loads(payload_raw)

    user_text = payload.get("user_text", "")
    if not user_text.strip():
        return

    user_id = payload.get("user_id", "anonymous")

    # Resolve per-user vocab learner from the LRU cache
    learner = _vocab_cache.get(user_id, redis_client=redis_client)

    # Lazily init relationship tracker
    global _rel_tracker
    if _rel_tracker is None and redis_bus.client:
        try:
            from backend.api.main import supabase as _supabase_client
            _rel_tracker = RelationshipTracker(
                redis_client=redis_bus.client,
                supabase_client=_supabase_client
            )
        except Exception:
            pass

    result = await run_turn_pipeline(
        engine=engine,
        user_text=user_text,
        session_id=session_id,
        user_id=user_id,
        ideology_hint=payload.get("ideology_hint"),
        user_initiated=payload.get("user_initiated", True),
        audio_rms=float(payload.get("audio_rms", 0.04)),
        pause_ms=float(payload.get("pause_ms", 500)),
        seed=payload.get("seed", ""),
        turn_history=payload.get("turn_history", []),
        personality_mode=payload.get("personality_mode", "adaptive"),
        vocab_learner=learner,
        embedding_cache=embedding_cache,
        rel_tracker=_rel_tracker,
        memory_timeout=MEMORY_TIMEOUT_SECONDS,
    )

    # ── Write to hot cache (consumer-specific output step) ──────────────────
    cached_result = {
        "act": result.act,
        "tags": result.tags,
        "template": result.template,
        "source": result.source,
        "energy": result.energy,
        "behavior_instructions": result.behavior_instructions,
        "emotional_state": result.emotional_state,
        "intensity": result.intensity,
        "sensing_state": result.sensing_state,
        "status": "success",
        "memory_layer": "live",
        "memory_enrichment": result.memory_enrichment,
        "language_profile": result.language_profile,
        "all_scores": result.all_scores,
        "relationship": result.relationship,
        "intelligence_context": result.intelligence_context,
        "toxicity": result.toxicity,
        # Metadata for cache freshness / debugging
        "_turn_number": result.sensing_state.get("session_turn", 0),
        "_processed_by": "brain3",
        "_memory_retrieved_at": time.time(),
    }

    await write_cached_analysis(session_id, cached_result)
    log.info(
        "message_consumed",
        session_id=session_id,
        user_id=user_id,
        turn_index=result.sensing_state.get("session_turn", 0),
        processing_ms=result.processing_ms,
        arc=result.sensing_state.get("arc", "?"),
        mode=result.directive.get("mode", "?"),
        has_memories=bool(result.memory_enrichment),
    )


