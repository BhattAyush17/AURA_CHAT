"""
Component 2: User Speech Profile Engine

Creates and maintains persistent per-user speech profiles.
All updates use exponential moving averages (EMA) to prevent
abrupt behavior changes. Learning is slow and stable.
"""

import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional


# EMA smoothing factors — lower = slower learning, more stable
_EMA_PAUSE = 0.08       # Pause average: ~12 turns to converge
_EMA_COMFORT = 0.05     # Comfort pause: ~20 turns (most conservative)
_EMA_RATE = 0.10        # Speaking rate: ~10 turns
_EMA_THINKING = 0.06    # Thinking score: ~16 turns
_EMA_STORY = 0.04       # Storytelling score: ~25 turns
_EMA_PATIENCE = 0.07    # Response patience: ~14 turns
_EMA_INTERRUPT = 0.10   # Interruptibility score


@dataclass
class UserSpeechProfile:
    """
    Persistent speech profile for a single user.

    All values evolve slowly via EMA to build a unique conversational
    rhythm fingerprint over time.
    """
    user_id: str = "anonymous"

    # Core timing metrics (Pause Zones instead of avg_pause_ms)
    micro_pause_ms: float = 300.0
    thinking_pause_ms: float = 800.0
    deep_pause_ms: float = 1500.0
    
    comfort_pause_ms: float = 900.0      # How long before they feel "waited on"
    speaking_rate: float = 140.0         # Words per minute

    # Behavioral scores (0.0 → 1.0)
    thinking_pause_score: float = 0.5    # How often pauses are "thinking" vs "done"
    storytelling_score: float = 0.3      # Tendency to tell long narratives
    response_patience: float = 0.5       # Preference for patient vs. instant replies
    burst_speaker_score: float = 0.3     # Speaks in rapid short bursts

    # Interruption tracking
    interruption_count: int = 0          # Total false detections this profile has seen
    interruption_rate: float = 0.0       # Recent interruptions per session
    interruptibility_score: float = 0.5  # Receptivity to being interrupted

    # Session metadata
    total_sessions: int = 0
    total_turns: int = 0
    last_session_timestamp: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_dict(cls, data: dict) -> "UserSpeechProfile":
        allowed = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in allowed}
        return cls(**filtered)

    @classmethod
    def from_json(cls, raw: str) -> "UserSpeechProfile":
        return cls.from_dict(json.loads(raw))


class UserSpeechProfileEngine:
    """
    Updates a UserSpeechProfile with new observations using EMA.

    Every update nudges values gently — the profile converges over
    dozens of turns, not in a single interaction.
    """

    @staticmethod
    def _ema(current: float, new_value: float, alpha: float) -> float:
        """Exponential Moving Average: blends new observation into current."""
        return current * (1.0 - alpha) + new_value * alpha
        
    def _get_ema_multiplier(self, profile: UserSpeechProfile) -> float:
        """Session Recalibration: faster learning in the first 2 minutes."""
        if time.time() - profile.last_session_timestamp < 120.0:
            return 2.0
        return 1.0

    def update(
        self,
        profile: UserSpeechProfile,
        *,
        observed_pause_ms: Optional[float] = None,
        observed_wpm: Optional[float] = None,
        utterance_word_count: Optional[int] = None,
        silence_before_response_ms: Optional[float] = None,
        was_thinking_pause: Optional[bool] = None,
        was_storytelling: Optional[bool] = None,
        was_burst: Optional[bool] = None,
    ) -> UserSpeechProfile:
        """
        Apply a single observation to the profile.

        Parameters are all optional — pass only what you observed.
        """
        ema_mult = self._get_ema_multiplier(profile)
        
        if observed_pause_ms is not None and observed_pause_ms > 50:
            # Pause Zones
            if observed_pause_ms < 500:
                profile.micro_pause_ms = self._ema(profile.micro_pause_ms, observed_pause_ms, _EMA_PAUSE * ema_mult)
            elif observed_pause_ms < 1200:
                profile.thinking_pause_ms = self._ema(profile.thinking_pause_ms, observed_pause_ms, _EMA_PAUSE * ema_mult)
            else:
                profile.deep_pause_ms = self._ema(profile.deep_pause_ms, observed_pause_ms, _EMA_PAUSE * ema_mult)

        if observed_wpm is not None and observed_wpm > 0:
            profile.speaking_rate = self._ema(profile.speaking_rate, observed_wpm, _EMA_RATE * ema_mult)

        if was_thinking_pause is not None:
            target = 1.0 if was_thinking_pause else 0.0
            profile.thinking_pause_score = self._ema(
                profile.thinking_pause_score, target, _EMA_THINKING * ema_mult
            )

        if was_storytelling is not None:
            target = 1.0 if was_storytelling else 0.0
            profile.storytelling_score = self._ema(
                profile.storytelling_score, target, _EMA_STORY * ema_mult
            )

        if was_burst is not None:
            target = 1.0 if was_burst else 0.0
            profile.burst_speaker_score = self._ema(
                profile.burst_speaker_score, target, _EMA_RATE * ema_mult
            )

        if silence_before_response_ms is not None:
            profile.comfort_pause_ms = self._ema(
                profile.comfort_pause_ms, silence_before_response_ms, _EMA_COMFORT * ema_mult
            )

        if observed_pause_ms is not None:
            patience_signal = min(1.0, observed_pause_ms / 2000.0)
            profile.response_patience = self._ema(
                profile.response_patience, patience_signal, _EMA_PATIENCE * ema_mult
            )

        profile.total_turns += 1
        return profile

    def register_interruption(self, profile: UserSpeechProfile) -> UserSpeechProfile:
        """
        Record a false turn detection (AURA spoke too soon).

        This is the STRONGEST learning signal. Comfort pause increases
        aggressively to prevent future premature responses.
        """
        ema_mult = self._get_ema_multiplier(profile)
        
        profile.interruption_count += 1

        adjustment = min(150.0, 80.0 + profile.interruption_count * 5.0)
        profile.comfort_pause_ms = min(2200.0, profile.comfort_pause_ms + adjustment)

        profile.response_patience = min(1.0, profile.response_patience + 0.08)
        profile.interruption_rate = self._ema(profile.interruption_rate, 1.0, 0.15 * ema_mult)
        
        # AURA interrupted, so interruptibility drops
        profile.interruptibility_score = self._ema(profile.interruptibility_score, 0.0, _EMA_INTERRUPT * ema_mult)

        return profile

    def start_session(self, profile: UserSpeechProfile) -> UserSpeechProfile:
        """Mark the start of a new session."""
        profile.total_sessions += 1
        profile.last_session_timestamp = time.time()
        # Decay interruption rate between sessions
        profile.interruption_rate *= 0.7
        return profile
