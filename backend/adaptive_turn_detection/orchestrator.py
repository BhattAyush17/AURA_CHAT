"""
Orchestrator: AdaptiveTurnDetector

The single top-level class that wires all sub-components together
and exposes the clean public API defined in the spec.
"""

import json
import time
from typing import Optional, Dict, Any

from .speech_analyzer import SpeechAnalyzer, SpeechEvent
from .profile_engine import UserSpeechProfile, UserSpeechProfileEngine
from .turn_confidence import TurnConfidenceEngine, TurnConfidenceResult
from .context_layer import (
    ConversationContextLayer, ConversationMode, ContextSignals,
)
from .interruption_learner import InterruptionLearner
from .response_timing import ResponseTimingEngine


class AdaptiveTurnDetector:
    """
    Provider-agnostic adaptive end-of-turn intelligence module.

    Sits between Voice Activity Detection and Response Generation.
    No coupling to Gemini, OpenRouter, DeepSeek, Sarvam, or any
    TTS provider.

    Public API:
      process_audio_event()
      update_user_profile()
      calculate_turn_confidence()
      register_false_detection()
      get_response_delay()
      save_profile()
      load_profile()
      get_telemetry()
    """

    def __init__(
        self,
        user_id: str = "anonymous",
        threshold: float = 0.95,
    ):
        self.user_id = user_id

        # Sub-components
        self._analyzer = SpeechAnalyzer()
        self._profile_engine = UserSpeechProfileEngine()
        self._confidence_engine = TurnConfidenceEngine(threshold=threshold)
        self._context_layer = ConversationContextLayer()
        self._interruption_learner = InterruptionLearner()
        self._timing_engine = ResponseTimingEngine()

        # User profile (loaded or fresh)
        self._profile = UserSpeechProfile(user_id=user_id)

        # Current turn state
        self._current_mode = ConversationMode.DISCUSSION
        self._current_text = ""
        self._last_confidence: Optional[TurnConfidenceResult] = None
        self._emotional_intensity = 0.0
        self._last_personality = "assistant"

    # ═══════════════════════════════════════════════════════════════
    # PUBLIC API
    # ═══════════════════════════════════════════════════════════════

    def process_audio_event(
        self,
        event_type: str,
        timestamp_ms: Optional[float] = None,
        text: Optional[str] = None,
        rms: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Feed a raw audio event into the pipeline.
        """
        ts = timestamp_ms or (time.monotonic() * 1000)
        event = SpeechEvent(
            event_type=event_type,
            timestamp_ms=ts,
            text=text,
            rms=rms,
        )
        snapshot = self._analyzer.process_event(event)

        # Track text for context classification
        if text:
            self._current_text += " " + text

        # On speech_start, check if this is an interruption
        if event_type == "speech_start":
            was_false = self._interruption_learner.check_user_resumed(
                timestamp_ms=ts,
                silence_before_ms=snapshot.current_silence_ms,
                conversation_mode=self._current_mode.value,
            )
            if was_false:
                self._profile = self._profile_engine.register_interruption(
                    self._profile
                )

        return {
            "snapshot": {
                "silence_ms": snapshot.current_silence_ms,
                "speech_ms": snapshot.current_speech_ms,
                "wpm": round(snapshot.words_per_minute, 1),
                "is_speaking": snapshot.is_speaking,
                "total_words": snapshot.total_words_this_turn,
            },
        }

    def update_user_profile(
        self,
        observed_pause_ms: Optional[float] = None,
        observed_wpm: Optional[float] = None,
        utterance_word_count: Optional[int] = None,
        was_thinking_pause: Optional[bool] = None,
        was_storytelling: Optional[bool] = None,
        was_burst: Optional[bool] = None,
    ):
        """Incrementally update the user's speech profile."""
        self._profile = self._profile_engine.update(
            self._profile,
            observed_pause_ms=observed_pause_ms,
            observed_wpm=observed_wpm,
            utterance_word_count=utterance_word_count,
            was_thinking_pause=was_thinking_pause,
            was_storytelling=was_storytelling,
            was_burst=was_burst,
        )

    def calculate_turn_confidence(
        self,
        silence_ms: Optional[float] = None,
        text: Optional[str] = None,
        emotional_intensity: float = 0.0,
        context_signals: Optional[Dict] = None,
    ) -> TurnConfidenceResult:
        """
        Calculate turn-end confidence. The core decision function.
        """
        if silence_ms is None:
            snap = self._analyzer.snapshot()
            silence_ms = snap.current_silence_ms

        utterance = text or self._current_text.strip()
        word_count = len(utterance.split()) if utterance else 0
        
        self._last_personality = context_signals.get("personality", "assistant") if context_signals else "assistant"

        signals = ContextSignals(
            emotional_intensity=emotional_intensity,
            tension=context_signals.get("tension", 0) if context_signals else 0,
            trust=context_signals.get("trust", 0.3) if context_signals else 0.3,
            user_word_count=word_count,
            storytelling_score=self._profile.storytelling_score,
        )

        if utterance:
            self._current_mode = self._context_layer.classify(utterance, signals)

        self._emotional_intensity = emotional_intensity
        patience = self._context_layer.get_patience_multiplier(self._current_mode)

        result = self._confidence_engine.calculate(
            silence_ms=silence_ms,
            profile=self._profile,
            mode=self._current_mode,
            patience_multiplier=patience,
            utterance_word_count=word_count,
            emotional_intensity=emotional_intensity,
            text=utterance,
        )

        self._last_confidence = result
        return result

    def register_false_detection(self):
        """
        Manually flag that AURA's last response was premature.
        """
        self._profile = self._profile_engine.register_interruption(self._profile)

    def get_response_delay(self, emotional_intensity: float = 0.0) -> int:
        """
        Get the human-like response delay in ms.
        """
        return self._timing_engine.get_response_delay(
            mode=self._current_mode,
            profile=self._profile,
            emotional_intensity=emotional_intensity,
            personality=self._last_personality,
        )

    def mark_aura_speaking(self, timestamp_ms: Optional[float] = None):
        """Call when AURA starts speaking to enable interruption detection."""
        self._interruption_learner.mark_aura_speaking(timestamp_ms)

    def save_profile(self) -> str:
        """Serialize the user profile to JSON for persistence."""
        return self._profile.to_json()

    def load_profile(self, raw: str):
        """Load a previously saved user profile."""
        self._profile = UserSpeechProfile.from_json(raw)
        self._profile.user_id = self.user_id

    def load_profile_dict(self, data: dict):
        """Load from a dict (e.g. from memory/Supabase)."""
        self._profile = UserSpeechProfile.from_dict(data)
        self._profile.user_id = self.user_id

    def start_session(self):
        """Mark the beginning of a new voice session."""
        self._profile = self._profile_engine.start_session(self._profile)
        self._analyzer.reset()
        self._interruption_learner.reset_session()
        self._current_text = ""
        self._current_mode = ConversationMode.DISCUSSION

    def reset_turn(self):
        """Reset per-turn state after a successful response."""
        self._current_text = ""
        self._last_confidence = None
        self._analyzer.reset()

    # ═══════════════════════════════════════════════════════════════
    # TELEMETRY
    # ═══════════════════════════════════════════════════════════════

    def get_telemetry(self) -> Dict[str, Any]:
        """
        Structured telemetry for observability and debug visualization.
        """
        snap = self._analyzer.snapshot()
        conf = self._last_confidence

        return {
            "silence_ms": round(snap.current_silence_ms, 1),
            "turn_confidence": conf.confidence if conf else 0.0,
            "conversation_mode": self._current_mode.value,
            "response_delay": self.get_response_delay(self._emotional_intensity),
            "false_detection": self._interruption_learner.session_interruption_count > 0,
            "profile": {
                "micro_pause_ms": round(self._profile.micro_pause_ms, 1),
                "thinking_pause_ms": round(self._profile.thinking_pause_ms, 1),
                "deep_pause_ms": round(self._profile.deep_pause_ms, 1),
                "comfort_pause_ms": round(self._profile.comfort_pause_ms, 1),
                "speaking_rate": round(self._profile.speaking_rate, 1),
                "thinking_pause_score": round(self._profile.thinking_pause_score, 3),
                "storytelling_score": round(self._profile.storytelling_score, 3),
                "response_patience": round(self._profile.response_patience, 3),
                "interruption_count": self._profile.interruption_count,
                "interruptibility_score": round(self._profile.interruptibility_score, 3),
            },
            "session_interruptions": self._interruption_learner.session_interruption_count,
            "semantic_completion": conf.semantic_completion if conf else 0.5,
            "thinking_confidence": conf.thinking_confidence if conf else 0.0,
            "emotion_bonus": conf.emotion_bonus if conf else 0.0,
        }

    @property
    def profile(self) -> UserSpeechProfile:
        return self._profile
