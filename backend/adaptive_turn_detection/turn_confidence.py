"""
Component 3: Turn Confidence Engine

Calculates a 0.0→1.0 confidence score for whether the user
has finished their turn. Does NOT rely on fixed silence thresholds.
Upgraded with semantic heuristics, thinking confidence, and emotion bonuses.
"""

from dataclasses import dataclass
from typing import Optional
import re
from .profile_engine import UserSpeechProfile
from .context_layer import ConversationMode


# Default response threshold — AURA responds only when confidence >= this
DEFAULT_THRESHOLD = 0.95

# Safety: absolute maximum wait regardless of confidence (ms)
ABSOLUTE_MAX_WAIT_MS = 2500.0


@dataclass
class TurnConfidenceResult:
    """Output of the confidence calculation."""
    confidence: float            # 0.0 → 1.0
    should_respond: bool         # confidence >= threshold
    silence_ms: float            # Raw silence duration
    effective_threshold: float   # Adjusted threshold for this turn
    reason: str                  # Human-readable explanation
    semantic_completion: float   # Semantic completion score
    thinking_confidence: float   # Thinking confidence score
    emotion_bonus: float         # Emotional pause bonus added


class TurnConfidenceEngine:
    """
    Multi-signal turn-end confidence calculator.

    Inputs:
      - silence duration
      - user average pause (from profile)
      - speaking rate
      - utterance length
      - interruption history
      - emotional context score
      - conversation mode
      - text (for semantic & thinking heuristics)

    Output: confidence 0.0 → 1.0
    """

    def __init__(self, threshold: float = DEFAULT_THRESHOLD):
        self.threshold = threshold
        
        self._sem_incomplete_re = re.compile(r"(and|or|but|because|so|if|then|with|about|for|to|from|the|a|an)$", re.IGNORECASE)
        self._sem_complete_re = re.compile(r"[.!?]$")
        self._think_fillers_re = re.compile(r"\b(um|umm|uh|uhh|hm|hmm|like|actually wait|let me think)\b", re.IGNORECASE)
        self._think_restarts_re = re.compile(r"\b(i mean|no wait|scratch that)\b", re.IGNORECASE)
        self._emo_words_re = re.compile(r"\b(sad|afraid|hurt|miss|lonely|overwhelmed|crying|painful|broken|devastated|scared)\b", re.IGNORECASE)

    def _get_semantic_completion(self, text: str) -> float:
        t = text.strip()
        if not t:
            return 0.5
        if self._sem_incomplete_re.search(t):
            return 0.1
        if self._sem_complete_re.search(t):
            return 0.9
        return 0.5

    def _get_thinking_confidence(self, text: str) -> float:
        t = text.lower()
        score = 0.0
        fillers = self._think_fillers_re.findall(t)
        if fillers:
            score += len(fillers) * 0.2
        if self._think_restarts_re.search(t):
            score += 0.3
        return min(1.0, score)
        
    def _get_emotion_bonus(self, text: str) -> float:
        t = text.lower()
        emo_matches = self._emo_words_re.findall(t)
        if not emo_matches:
            return 0.0
        return min(500.0, len(emo_matches) * 100.0)

    def calculate(
        self,
        silence_ms: float,
        profile: UserSpeechProfile,
        mode: ConversationMode,
        patience_multiplier: float = 1.0,
        utterance_word_count: int = 0,
        emotional_intensity: float = 0.0,
        text: str = "",
    ) -> TurnConfidenceResult:
        """
        Calculate turn-end confidence from multiple signals.
        """
        # Local lightweight heuristics
        sem_completion = self._get_semantic_completion(text)
        thinking_conf = self._get_thinking_confidence(text)
        emo_bonus = self._get_emotion_bonus(text)

        # ── Step 1: Effective wait target ─────────────────────────
        base_wait = profile.comfort_pause_ms
        effective_wait = base_wait * patience_multiplier

        if emotional_intensity > 0.5:
            emotional_extension = 1.0 + (emotional_intensity - 0.5) * 0.6
            effective_wait *= emotional_extension

        if profile.interruption_rate > 0.1:
            effective_wait *= 1.0 + profile.interruption_rate * 0.5
            
        # Add Emotional Recovery Silence
        effective_wait += emo_bonus

        # Safety clamp
        effective_wait = min(effective_wait, ABSOLUTE_MAX_WAIT_MS)

        # ── Step 2: Silence ratio ─────────────────────────────────
        if effective_wait <= 0:
            silence_ratio = 1.0
        else:
            silence_ratio = silence_ms / effective_wait

        # ── Step 3: Multi-signal confidence blend ─────────────────
        silence_conf = self._sigmoid(silence_ratio, midpoint=1.0, steepness=4.0)

        completeness_conf = self._utterance_completeness(
            utterance_word_count, profile.speaking_rate
        )

        rate_adjustment = 0.0
        if profile.speaking_rate > 160:
            rate_adjustment = 0.05
        elif profile.speaking_rate < 100:
            rate_adjustment = -0.05

        # Blended inputs
        confidence = (
            silence_conf * 0.60
            + sem_completion * 0.20
            + completeness_conf * 0.10
            + (profile.interruptibility_score - 0.5) * 0.10
            + rate_adjustment
        )
        
        # Thinking penalty
        confidence -= thinking_conf * 0.3

        # ── Step 4: Absolute safety override ──────────────────────
        if silence_ms >= ABSOLUTE_MAX_WAIT_MS:
            confidence = 1.0
            reason = f"Safety max wait ({ABSOLUTE_MAX_WAIT_MS}ms) reached"
        else:
            reason = (
                f"silence={silence_ms:.0f}ms, "
                f"eff_wait={effective_wait:.0f}ms, "
                f"sem={sem_completion:.2f}, "
                f"think={thinking_conf:.2f}"
            )

        # Clamp
        confidence = max(0.0, min(1.0, confidence))

        # ── Step 5: Threshold adjustment ──────────────────────────
        effective_threshold = self.threshold
        if mode == ConversationMode.COMMAND:
            effective_threshold = max(0.80, self.threshold - 0.10)
        elif mode in (ConversationMode.EMOTIONAL, ConversationMode.REFLECTIVE):
            effective_threshold = min(0.98, self.threshold + 0.02)

        should_respond = confidence >= effective_threshold

        return TurnConfidenceResult(
            confidence=round(confidence, 4),
            should_respond=should_respond,
            silence_ms=silence_ms,
            effective_threshold=round(effective_threshold, 4),
            reason=reason,
            semantic_completion=round(sem_completion, 4),
            thinking_confidence=round(thinking_conf, 4),
            emotion_bonus=round(emo_bonus, 4),
        )

    @staticmethod
    def _sigmoid(x: float, midpoint: float = 1.0, steepness: float = 4.0) -> float:
        """Smooth S-curve: 0 at x<<midpoint, 1 at x>>midpoint."""
        import math
        try:
            return 1.0 / (1.0 + math.exp(-steepness * (x - midpoint)))
        except OverflowError:
            return 0.0 if x < midpoint else 1.0

    @staticmethod
    def _utterance_completeness(word_count: int, wpm: float) -> float:
        if word_count <= 2:
            return 0.7
        elif word_count <= 5:
            return 0.5
        elif word_count <= 15:
            return 0.4
        else:
            return 0.6
