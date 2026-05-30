"""
Component 5: Interruption Learning Engine

Detects false turn detections (AURA spoke too soon) and feeds
the strongest learning signal back into the user profile.
"""

import time
from dataclasses import dataclass, field
from collections import deque
from typing import Deque, Optional


@dataclass
class InterruptionEvent:
    """Record of a single false turn detection."""
    timestamp: float
    silence_before_ms: float    # How long AURA waited before speaking
    user_resumed_after_ms: float  # How quickly user started talking again
    conversation_mode: str = "discussion"


class InterruptionLearner:
    """
    Tracks interruption patterns and provides adjustment signals.

    Detection rule: AURA begins speaking AND user starts speaking
    within N milliseconds → treat as false turn detection.
    """

    # If user resumes within this window, it's a false detection
    FALSE_DETECTION_WINDOW_MS = 800.0

    # Rolling history for analysis
    _HISTORY_SIZE = 30

    def __init__(self):
        self._history: Deque[InterruptionEvent] = deque(maxlen=self._HISTORY_SIZE)
        self._session_count: int = 0
        self._aura_speak_start_ms: Optional[float] = None

    def mark_aura_speaking(self, timestamp_ms: Optional[float] = None):
        """Call when AURA starts speaking a response."""
        self._aura_speak_start_ms = timestamp_ms or (time.monotonic() * 1000)

    def check_user_resumed(
        self,
        timestamp_ms: Optional[float] = None,
        silence_before_ms: float = 0.0,
        conversation_mode: str = "discussion",
    ) -> bool:
        """
        Call when user starts speaking again.

        Returns True if this constitutes a false turn detection.
        """
        now = timestamp_ms or (time.monotonic() * 1000)

        if self._aura_speak_start_ms is None:
            return False

        gap = now - self._aura_speak_start_ms
        self._aura_speak_start_ms = None

        if gap <= self.FALSE_DETECTION_WINDOW_MS:
            event = InterruptionEvent(
                timestamp=time.time(),
                silence_before_ms=silence_before_ms,
                user_resumed_after_ms=gap,
                conversation_mode=conversation_mode,
            )
            self._history.append(event)
            self._session_count += 1
            return True

        return False

    @property
    def session_interruption_count(self) -> int:
        return self._session_count

    @property
    def avg_silence_before_interruption(self) -> float:
        """Average silence that preceded false detections."""
        if not self._history:
            return 0.0
        return sum(e.silence_before_ms for e in self._history) / len(self._history)

    @property
    def comfort_adjustment_ms(self) -> float:
        """
        Suggested increase to comfort_pause_ms based on recent
        interruption patterns. Minimum of the average silence gap
        that caused false detections.
        """
        if not self._history:
            return 0.0
        avg_gap = self.avg_silence_before_interruption
        # Add a 30% buffer above the silence that failed
        return avg_gap * 0.3

    def reset_session(self):
        """Reset session counter (keep history for cross-session learning)."""
        self._session_count = 0
        self._aura_speak_start_ms = None
