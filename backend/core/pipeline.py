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
from typing import Optional, Any

from backend.infrastructure.logging import get_logger
from backend.core.behavior import (
    RuntimeEngine,
    build_sensing_injection,
    detect_language_profile,
)
from backend.memory.sync import get_chromadb_enrichment_v2
from backend.core.vocab import VocabLearner
from backend.core.intelligence import composer
from backend.personality.toxicity_engine import process_toxicity_pipeline

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

    combined_injection = sensing_injection + (vocab_injection or "")

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
    except Exception as e:
        log.debug("toxicity_pipeline_failed", error=str(e))

    # ── Step 4.7: Memory Retrieval (async, timeout-protected) ────────────────
    memory_enrichment = ""
    try:
        memory_enrichment = await asyncio.wait_for(
            get_chromadb_enrichment_v2(
                current_text=user_text,
                state_vector={
                    "arc": state_vector.arc,
                    "energy": state_vector.energy,
                    "trust": state_vector.trust,
                },
                user_id=user_id,
                timeout=memory_timeout,
                embedding_cache=embedding_cache,
            ),
            timeout=memory_timeout + 0.1,
        )
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
