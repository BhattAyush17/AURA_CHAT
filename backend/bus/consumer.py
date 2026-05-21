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
from google import genai
from google.genai import types

# ─── Per-user VocabLearner cache ──────────────────────────────────────────────
# Each user gets their own VocabLearner instance (loaded from Redis/Supabase).
# Evict entries idle for > 30 minutes to bound memory.

_VOCAB_CACHE_TTL = 1800  # 30 minutes in seconds

class _VocabCache:
    def __init__(self):
        self._cache: dict[str, tuple[VocabLearner, float]] = {}  # user_id → (learner, last_used_ts)

    def get(self, user_id: str, redis_client=None, supabase_client=None) -> VocabLearner:
        learner, _ = self._cache.get(user_id, (None, 0))
        if learner is None:
            if supabase_client is None:
                try:
                    from server import supabase as _supabase_client
                    supabase_client = _supabase_client
                except Exception:
                    pass
            learner = VocabLearner(redis_client=redis_client, supabase_client=supabase_client)
            self._cache[user_id] = (learner, time.monotonic())
        else:
            self._cache[user_id] = (learner, time.monotonic())
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
async def gemini_embed_fn(text: str) -> list[float]:
    """Async wrapper around Gemini embedding-001 (768-dim)."""
    # Note: Using same model as memory_sync.py for consistency
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
    
    def _call():
        result = client.models.embed_content(
            model="gemini-embedding-001",
            contents=[text],
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        return list(result.embeddings[0].values)
    
    return await asyncio.to_thread(_call)

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
    from server import supabase as _supabase_client
    set_vocab_learner_clients(redis_client=client, supabase_client=_supabase_client)

    # Initialize Embedding Cache
    global embedding_cache
    embedding_cache = EmbeddingCache(redis_client=client, embed_fn=gemini_embed_fn)

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
    Process a single transcript turn through the existing
    behavior engine pipeline. Writes result to Redis cache.

    This function calls the EXACT SAME code paths as the
    current synchronous /api/analyze handler.
    """
    t0 = time.perf_counter()
    session_id = fields.get("session_id", "")
    payload_raw = fields.get("payload", "{}")
    payload = json.loads(payload_raw)

    user_text = payload.get("user_text", "")
    if not user_text.strip():
        return

    user_id = payload.get("user_id", "anonymous")
    ideology_hint = payload.get("ideology_hint")
    user_initiated = payload.get("user_initiated", True)
    audio_rms = float(payload.get("audio_rms", 0.04))
    pause_ms = float(payload.get("pause_ms", 500))
    seed = payload.get("seed", "")
    frustration_score = float(payload.get("frustration_score", 0.0))
    withdrawal_score = float(payload.get("withdrawal_score", 0.0))
    personality_mode = payload.get("personality_mode", "adaptive")

    # ── Step 1: Keyword + Emotional Routing (existing RuntimeEngine) ──
    result = engine.analyze(user_text, ideology_hint, user_initiated)

    # ── Step 2: Language Detection (existing) ──
    lang_profile = detect_language_profile(user_text)

    # ── Step 3: Sensing Injection (existing) ──
    turn_data = {
        "text": user_text,
        "audio_rms": audio_rms,
        "pause_ms": pause_ms,
        "frustration_score": result["all_scores"].get("frustration", frustration_score),
        "withdrawal_score": result["all_scores"].get("withdrawal", withdrawal_score),
        "language_profile": lang_profile,
    }

    sensing_injection, state_vector, directive = build_sensing_injection(
        session_id, turn_data, seed, user_id=user_id
    )

    # ── Step 4: Vocab Learning (per-user instance, with persistence) ──
    emotional_state = (
        "anger" if result["all_scores"].get("frustration", 0) > 0.6
        else "sadness" if state_vector.arc == "withdrawing"
        else "joy" if state_vector.arc == "building"
        else "frustration" if result["all_scores"].get("frustration", 0) > 0.3
        else "neutral"
    )

    learner = _vocab_cache.get(user_id, redis_client=redis_client)
    # Load from Redis/Supabase if this is the first time we see this user this session
    if user_id not in learner._profiles:
        await learner.load(user_id)

    learner.ingest_turn(
        user_id=user_id,
        text=user_text,
        lang_profile=lang_profile,
        emotional_state=emotional_state,
        is_greeting=state_vector.session_turn <= 1,
    )

    # Auto-save every SAVE_EVERY_N_TURNS turns (fire-and-forget)
    if learner.should_save(user_id):
        learner.reset_save_counter(user_id)
        asyncio.create_task(learner.save(user_id))

    vocab_summary_dict = learner.get_vocab_summary(user_id)
    if vocab_summary_dict.get("abuse_vocab"):
        lang_profile["user_abuse_vocab"] = vocab_summary_dict["abuse_vocab"]

    vocab_injection = learner.build_vocab_injection(user_id)
    combined_injection = sensing_injection + (vocab_injection or "")

    # ── General Intelligence Context Layer (Middleware) ──
    intel_ctx = await composer.get_context(
        query=user_text,
        client_device_info={"mic_available": audio_rms > 0},
        session_id=session_id
    )
    intel_prompt = composer.serialize_to_prompt(intel_ctx)
    
    # Prepend intelligence prompt
    combined_injection = f"{intel_prompt}\n\n{combined_injection}"

    # ── Personality & Toxicity Pipeline (Middleware) ──
    toxicity_result = process_toxicity_pipeline(user_text, session_id=session_id, mode=personality_mode)
    if toxicity_result.get("toxicity_detected"):
        personality_prompt = (
            f"[PERSONALITY OVERRIDE]\n"
            f"Mode: {toxicity_result.get('personality_mode')}\n"
            f"Intent: {toxicity_result.get('intent')}\n"
            f"Style: {toxicity_result.get('response_style')}\n"
            f"User Slang Profile: {', '.join(toxicity_result.get('user_custom_slang', []))}\n"
            f"Matched Terms: {', '.join(toxicity_result.get('matched_terms', []))}\n"
            f"[/PERSONALITY OVERRIDE]"
        )
        combined_injection = f"{combined_injection}\n\n{personality_prompt}"

    # ── Step 4.5: Memory Retrieval (MOVED OFF HOT PATH — was in server.py) ──
    # Uses match_memories_v2 for hybrid semantic + temporal scoring.
    # Falls back to v1 if v2 RPC is not deployed yet.
    memory_enrichment = ""
    try:
        t_mem = time.monotonic()
        memory_enrichment = await asyncio.wait_for(
            get_chromadb_enrichment_v2(
                current_text=user_text,
                state_vector={
                    "arc": state_vector.arc,
                    "energy": state_vector.energy,
                    "trust": state_vector.trust,
                },
                user_id=user_id,
                timeout=MEMORY_TIMEOUT_SECONDS,
                embedding_cache=embedding_cache,
            ),
            timeout=MEMORY_TIMEOUT_SECONDS + 0.1,
        )
        mem_ms = round((time.monotonic() - t_mem) * 1000, 1)
        if mem_ms > 500:
            log.warning("memory_retrieval_slow", session_id=session_id, duration_ms=mem_ms)
    except asyncio.TimeoutError:
        log.warning("memory_retrieval_timeout", session_id=session_id)
        memory_enrichment = ""
    except Exception as e:
        log.warning("memory_retrieval_failed", session_id=session_id, error=str(e))
        memory_enrichment = ""

    # ── Step 4.6: Relationship stage tracking ──
    rel_injection = ""
    try:
        global _rel_tracker
        if _rel_tracker is None and redis_bus.client:
            # Lazy import to avoid circular dependency — server.py imports this module
            from server import supabase as _supabase_client
            _rel_tracker = RelationshipTracker(
                redis_client=redis_bus.client, 
                supabase_client=_supabase_client
            )
        if _rel_tracker:
            # P6 FIX: update_trust returns the profile — no redundant get_profile() call
            rel_profile = await _rel_tracker.update_trust(user_id, state_vector.trust)
            rel_injection = rel_profile.to_prompt_injection()
    except Exception as e:
        log.debug("relationship_tracking_failed", error=str(e))

    # ── Step 5: Build final instructions (existing) ──
    if memory_enrichment:
        combined_injection = combined_injection + f"\n\n{memory_enrichment}"
    result["sensing_injection"] = combined_injection
    instructions = engine.build_instructions(result)

    # ── Step 6: Write to hot cache ──
    cached_result = {
        "act": result["act"],
        "tags": result["tags"],
        "template": result.get("template"),
        "source": result["source"],
        "energy": result["energy"],
        "behavior_instructions": instructions,
        "emotional_state": result["emotional_state"],
        "intensity": result["intensity"],
        "sensing_state": {
            "energy": round(state_vector.energy, 2),
            "warmth": round(state_vector.warmth, 2),
            "engagement": round(state_vector.engagement, 2),
            "trust": round(state_vector.trust, 2),
            "tension": round(state_vector.tension, 2),
            "arc": state_vector.arc,
            "arc_turns": state_vector.arc_turns,
            "mode": directive["mode"],
            "injection_type": directive.get("injection_type", "passive"),
            "session_turn": state_vector.session_turn,
            "response_delay_hint": directive.get("response_delay_hint", 300),
        },
        "status": "success",
        "memory_layer": "live",
        "memory_enrichment": memory_enrichment,  # Now populated by worker, not server
        "language_profile": lang_profile,
        # Composite emotion vector (new — for prompt injection + frontend)
        "emotion_vector": result.get("emotion_vector", {}).to_compact()
            if hasattr(result.get("emotion_vector", {}), "to_compact") else "",
        "all_scores": result.get("all_scores", {}),
        # Metadata for cache freshness
        "_turn_number": state_vector.session_turn,
        "_processed_by": "brain3",
        "_memory_retrieved_at": time.time(),
        "relationship": rel_injection,
        "intelligence_context": intel_ctx,
        "toxicity": toxicity_result,
    }

    await write_cached_analysis(session_id, cached_result)
    processing_ms = round((time.perf_counter() - t0) * 1000, 2)
    log.info("message_consumed", session_id=session_id, user_id=user_id, turn_index=state_vector.session_turn, processing_ms=processing_ms, arc=state_vector.arc, mode=directive["mode"], has_memories=bool(memory_enrichment))
