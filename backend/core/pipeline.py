"""
AURA Core Turn Pipeline — Shared L1→L4 Processing Logic

Extracted from the dual implementations in:
  - backend/api/main.py   (sync fallback path)
  - backend/bus/consumer.py (_process_turn async worker path)

Both paths now call `run_turn_pipeline()` with their respective inputs and
receive a `TurnResult` dataclass they can use however they need (cache write
vs HTTP response construction).

This eliminates the DRY violation documented in:
  docs/audit/findings.md  — "Dual Logic Maintenance"
  docs/architecture/prioritized_fixes.md  — P2 #9

Design principles:
  - Pure function: no global side-effects.  Callers own persistence.
  - Async throughout: awaitable memory retrieval + vocab save tasks.
  - Fail-open: every optional step is guarded; partial failure returns
    whatever partial data is available.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Any

from backend.infrastructure.logging import get_logger
from backend.core.behavior import (
    RuntimeEngine,
    build_sensing_injection,
    detect_language_profile,
)
from backend.core.vocab import VocabLearner
from backend.core.intelligence import composer
from backend.personality.toxicity_engine import process_toxicity_pipeline
from backend.core.thought_field.AssociativeThoughtField import AssociativeThoughtField
from backend.core.thought_field.identity.IdentityEvolution import observe_turn_live
from backend.core.thought_field.CognitiveContext import CognitiveContext

log = get_logger("core.pipeline")


# ─── Result container ────────────────────────────────────────────────────────

@dataclass
class TurnResult:
    """
    Unified output of run_turn_pipeline().

    Contains everything needed to either:
      a) Write to Redis hot-cache (consumer path), or
      b) Build an AnalyzeResponse HTTP response (main.py sync path).
    """
    # Behavior routing
    act: str = ""
    tags: list = field(default_factory=list)
    template: Optional[str] = None
    source: str = "fallback"
    energy: str = "neutral"
    emotional_state: str = "neutral"
    intensity: str = "low"
    all_scores: dict = field(default_factory=dict)

    # Built instructions (L2 output)
    behavior_instructions: str = ""

    # Sensing
    sensing_state: dict = field(default_factory=dict)
    sensing_injection: str = ""
    directive: dict = field(default_factory=dict)

    # Language / vocab
    language_profile: dict = field(default_factory=dict)

    # Memory
    memory_enrichment: str = ""

    # Intelligence context (L6)
    intelligence_context: Any = None

    # Relationship injection fragment
    relationship: str = ""

    # Toxicity pipeline result
    toxicity: dict = field(default_factory=dict)

    # Metadata
    processing_ms: float = 0.0


# ─── Shared pipeline ─────────────────────────────────────────────────────────

async def run_turn_pipeline(
    *,
    engine: RuntimeEngine,
    user_text: str,
    session_id: str,
    user_id: str = "anonymous",
    ideology_hint: Optional[str] = None,
    user_initiated: bool = True,
    audio_rms: float = 0.04,
    pause_ms: float = 500.0,
    seed: str = "",
    turn_history: Optional[list] = None,
    personality_mode: str = "adaptive",
    vocab_learner: Optional[VocabLearner] = None,
    embedding_cache=None,
    rel_tracker=None,
    ip_address: Optional[str] = None,
    memory_timeout: float = 0.5,
    music_context: Optional[dict] = None,
) -> TurnResult:
    """
    Execute the full L1→L4 analysis pipeline for a single conversational turn.

    Args:
        engine:           RuntimeEngine singleton.
        user_text:        The user's utterance.
        session_id:       Active session identifier.
        user_id:          User identifier (used for vocab + relationship).
        ideology_hint:    Optional personality/topic hint.
        user_initiated:   Whether the turn was user-triggered.
        audio_rms:        Microphone RMS level (acoustic sensing).
        pause_ms:         Pause duration before this utterance.
        seed:             Persisted seed string from prior sessions.
        turn_history:     Recent turns for emotional routing context.
        personality_mode: Toxicity pipeline mode.
        vocab_learner:    Per-user VocabLearner instance (caller owns lifecycle).
        embedding_cache:  Optional Redis embedding cache.
        rel_tracker:      Optional RelationshipTracker for trust updates.
        ip_address:       Client IP for geo context (intelligence layer).
        memory_timeout:   Max seconds to wait for pgvector retrieval.

    Returns:
        TurnResult populated with all computed fields.
    """
    t0 = time.perf_counter()
    result = TurnResult()

    if not user_text.strip():
        return result

    if turn_history is None:
        turn_history = []

    # ── Step 1: Keyword + Emotional Routing (L2 RuntimeEngine) ──────────────
    raw = engine.analyze(user_text, ideology_hint, user_initiated, turn_history)
    result.act = raw["act"]
    result.tags = raw["tags"]
    result.template = raw.get("template")
    result.source = raw["source"]
    result.energy = raw["energy"]
    result.emotional_state = raw["emotional_state"]
    result.intensity = raw["intensity"]
    result.all_scores = raw.get("all_scores", {})

    # ── Step 2: Language Detection ───────────────────────────────────────────
    lang_profile = detect_language_profile(user_text)
    result.language_profile = lang_profile

    # ── Step 3: Sensing Injection (StateVector + directive) ──────────────────
    turn_data = {
        "text": user_text,
        "audio_rms": audio_rms,
        "pause_ms": pause_ms,
        "frustration_score": raw["all_scores"].get("frustration", 0.0),
        "withdrawal_score": raw["all_scores"].get("withdrawal", 0.0),
        "language_profile": lang_profile,
    }
    sensing_injection, state_vector, directive = build_sensing_injection(
        session_id, turn_data, seed, user_id=user_id, emotion=raw.get("emotion_vector")
    )
    result.directive = directive
    result.sensing_state = {
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
    }

    # ── Step 4: Vocab Learning ───────────────────────────────────────────────
    emotional_label = (
        "anger"      if raw["all_scores"].get("frustration", 0) > 0.6
        else "sadness"    if state_vector.arc == "withdrawing"
        else "joy"        if state_vector.arc == "building"
        else "frustration" if raw["all_scores"].get("frustration", 0) > 0.3
        else "neutral"
    )
    if vocab_learner is not None:
        if user_id not in vocab_learner._profiles:
            await vocab_learner.load(user_id)
        vocab_learner.ingest_turn(
            user_id=user_id,
            text=user_text,
            lang_profile=lang_profile,
            emotional_state=emotional_label,
            is_greeting=state_vector.session_turn <= 1,
        )
        if vocab_learner.should_save(user_id):
            vocab_learner.reset_save_counter(user_id)
            asyncio.create_task(vocab_learner.save(user_id))

        vocab_summary = vocab_learner.get_vocab_summary(user_id)
        if vocab_summary.get("abuse_vocab"):
            lang_profile["user_abuse_vocab"] = vocab_summary["abuse_vocab"]
        vocab_injection = vocab_learner.build_vocab_injection(user_id)
    else:
        vocab_injection = ""

    # ── Step 4.1-4.3: Associative Thought Field (ATF) ────────────────────────
    atf = AssociativeThoughtField.get_instance(session_id)
    ctx = CognitiveContext(
        session_id=session_id,
        transcript=user_text,
        conversation_metadata=turn_data,
        runtime_signals={"active_mode": personality_mode},
        music_context=music_context
    )
    envelope = atf.tick(ctx)
    cog_snapshot = envelope.cognitive_snapshot
    expression_behavior = envelope.behavior_expression
    
    # NOTE: Pre-existing typo fix on the integration path.
    # `SelfModel` exposes `.state` (a `SelfState`) directly; there is no
    # `get_state()` method. The previous form `atf.self_model.get_state()`
    # raised AttributeError and broke the whole pipeline. The freshly updated
    # state is already on `atf.self_model.state` because `atf.tick(ctx)`
    # invokes `self_model.update(...)` itself.
    self_prompt = atf.self_model.state.to_prompt_injection()
    combined_injection = sensing_injection + (vocab_injection or "") + f"\n\n{self_prompt}\n\n{cog_snapshot}\n\n{expression_behavior}"

    # ── Step 4.4: Turn-level live UserModel state observation ────────────────
    # Lightweight, fail-open. Owns only `current_state.topic` and
    # `recent_context.unresolved_items`. Persistence is fire-and-forget so
    # the conversational response path is never blocked.
    if user_id and user_id != "anonymous":
        try:
            dominant_theme = ""
            try:
                if getattr(atf, "awareness_history", None) and atf.awareness_history.frames:
                    dominant_theme = atf.awareness_history.frames[-1].dominant_theme or ""
            except Exception:
                dominant_theme = ""

            async def _fetch_live_model(uid: str):
                """Inline read of the UserModel from Supabase `aura_storage`.

                Duplicated from `backend.api.memory_endpoints._fetch_user_model`
                to avoid a top-level circular import (memory_endpoints -> main
                -> pipeline). The body is small and the schema is stable.
                """
                try:
                    from backend.api.main import supabase as _sb
                    if not _sb:
                        return None
                    from backend.infrastructure.runtime_telemetry import timing
                    from backend.core.thought_field.identity.UserModel import UserModel as _UM
                    with timing("supabase", "read_aura_storage"):
                        res = await _sb.table("aura_storage").select("data").eq("user_id", uid).eq("key", f"user_model_{uid}").execute()
                    if res.data and len(res.data) > 0:
                        return _UM.from_dict(res.data[0].get("data", {}))
                except Exception as e:
                    log.warning("live_state_fetch_failed user=%s err=%s", uid, e)
                return None

            async def _persist_live_state(model):
                """Merge our live-state fields with a fresh DB read, then upsert.

                Race characteristics: another process/session may update the
                same UserModel concurrently (notably the consolidation path,
                which mutates `unresolved_items` and `identity.*`). Because
                the existing persistence layer is a full-model upsert with
                no DB-level versioning, we mitigate by re-reading the row
                immediately before writing and preserving every field we did
                not touch. The only field where a residual last-writer-wins
                race remains is `recent_context.unresolved_items`.
                """
                try:
                    from backend.api.main import supabase as _sb
                    if not _sb:
                        return
                    fresh = await _fetch_live_model(model.user_id)
                    if fresh is None:
                        fresh = model  # write our local model as-is
                    # Preserve everything we didn't touch this turn.
                    fresh.current_state = model.current_state
                    fresh.recent_context.unresolved_items = list(
                        model.recent_context.unresolved_items
                    )
                    fresh.recent_changes = list(model.recent_changes)
                    fresh.metadata.updated_at = time.time()
                    # `updated_at` is timestamptz: a float epoch is rejected
                    # (22007). `on_conflict` is required because
                    # idx_aura_storage_user_key is UNIQUE on (user_id, key).
                    await _sb.table("aura_storage").upsert({
                        "user_id": fresh.user_id,
                        "key": f"user_model_{fresh.user_id}",
                        "data": fresh.to_dict(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }, on_conflict="user_id,key").execute()
                except Exception as e:
                    log.warning("live_state_persist_callback_failed err=%s", e)

            await observe_turn_live(
                user_id=user_id,
                session_id=session_id,
                transcript=user_text,
                dominant_theme=dominant_theme,
                fetch_model=_fetch_live_model,
                persist_model=_persist_live_state,
            )
        except Exception as e:
            log.warning("live_state_observe_skipped err=%s", e)

    # ── Step 4.5: Intelligence Context Layer (L6) ────────────────────────────
    try:
        intel_ctx = await composer.get_context(
            query=user_text,
            ip_address=ip_address,
            client_device_info={"mic_available": audio_rms > 0},
            session_id=session_id,
        )
        intel_prompt = composer.serialize_to_prompt(intel_ctx)
        combined_injection = f"{intel_prompt}\n\n{combined_injection}"
        result.intelligence_context = intel_ctx
    except Exception as e:
        log.debug("intel_context_failed", error=str(e))

    # ── Step 4.6: Toxicity / Personality Pipeline ────────────────────────────
    try:
        toxicity_result = process_toxicity_pipeline(
            user_text, session_id=session_id, mode=personality_mode
        )
        result.toxicity = toxicity_result
        # Note: Personality override is now exclusively handled by SocialAdaptation.
    except Exception as e:
        log.debug("toxicity_pipeline_failed", error=str(e))

    # ── Step 4.7: Memory Retrieval (async, timeout-protected) ────────────────
    memory_enrichment = ""
    try:
        from backend.memory.orchestration.orchestrator import get_orchestrator
        orchestrator = get_orchestrator()
        if orchestrator:
            block, _ = await asyncio.wait_for(
                orchestrator.read_context_block(
                    user_id=user_id,
                    query=user_text,
                    count=3,
                    correlation_id=session_id
                ),
                timeout=memory_timeout + 0.1,
            )
            memory_enrichment = block
        else:
            # Fallback to current state if orchestrator is missing
            from backend.memory.sync import frame_from_current_input
            memory_enrichment = frame_from_current_input(user_text, state_vector)
    except asyncio.TimeoutError:
        log.warning("pipeline_memory_timeout", session_id=session_id)
    except Exception as e:
        log.warning("pipeline_memory_failed", session_id=session_id, error=str(e))
    result.memory_enrichment = memory_enrichment

    # ── Step 4.8: Relationship Stage Tracking ───────────────────────────────
    rel_injection = ""
    if rel_tracker is not None:
        try:
            rel_profile = await rel_tracker.update_trust(user_id, state_vector.trust)
            rel_injection = rel_profile.to_prompt_injection()
        except Exception as e:
            log.debug("pipeline_relationship_failed", error=str(e))
    result.relationship = rel_injection

    # ── Step 5: Build Final Instructions ────────────────────────────────────
    if memory_enrichment:
        combined_injection = combined_injection + f"\n\n{memory_enrichment}"
    result.sensing_injection = combined_injection
    raw["sensing_injection"] = combined_injection
    result.behavior_instructions = engine.build_instructions(raw)

    result.processing_ms = round((time.perf_counter() - t0) * 1000, 2)
    return result
