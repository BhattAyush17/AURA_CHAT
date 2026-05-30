"""
Component 1: Real-Time Speech Analyzer

Continuously receives speech events (start, stop, silence, rate) and
maintains a rolling window of acoustic features for downstream engines.
"""

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Deque


@dataclass
class SpeechEvent:
    """A single atomic speech event from the VAD / STT layer."""
    event_type: str          # "speech_start" | "speech_stop" | "interim_text"
    timestamp_ms: float      # Monotonic ms timestamp
    text: Optional[str] = None
    rms: float = 0.0        # Root-mean-square mic energy at event time


@dataclass
class SpeechSnapshot:
    """Rolling snapshot of the user's current speaking state."""
    current_silence_ms: float = 0.0
    current_speech_ms: float = 0.0
    words_per_minute: float = 0.0
    pause_frequency: float = 0.0       # Pauses per minute of speech
    last_utterance_word_count: int = 0
    is_speaking: bool = False
    total_words_this_turn: int = 0
    turn_duration_ms: float = 0.0


class SpeechAnalyzer:
    """
    Stateful real-time speech analyzer.

    Receives raw speech events from the VAD/STT layer and computes
    rolling acoustic features without any provider coupling.
    """

    # Rolling window sizes
    _PAUSE_WINDOW = 20       # Last N pauses for avg calculation
    _SPEECH_WINDOW = 20      # Last N speech bursts
    _WPM_WINDOW_SEC = 30.0   # WPM calculation window

    def __init__(self):
        self._pause_durations: Deque[float] = deque(maxlen=self._PAUSE_WINDOW)
        self._speech_durations: Deque[float] = deque(maxlen=self._SPEECH_WINDOW)
        self._word_timestamps: Deque[float] = deque(maxlen=200)

        # Current state tracking
        self._speech_start_ms: Optional[float] = None
        self._silence_start_ms: Optional[float] = None
        self._is_speaking: bool = False
        self._total_words: int = 0
        self._turn_start_ms: Optional[float] = None
        self._last_utterance_words: int = 0
        self._pause_count: int = 0
        self._total_speech_ms: float = 0.0

    def reset(self):
        """Reset state for a new session turn."""
        self._speech_start_ms = None
        self._silence_start_ms = None
        self._is_speaking = False
        self._total_words = 0
        self._turn_start_ms = None
        self._last_utterance_words = 0
        self._pause_count = 0
        self._total_speech_ms = 0.0

    def process_event(self, event: SpeechEvent) -> SpeechSnapshot:
        """
        Process a single speech event and return the updated snapshot.

        This is the only entry point for raw audio events.
        """
        now = event.timestamp_ms

        if self._turn_start_ms is None:
            self._turn_start_ms = now

        if event.event_type == "speech_start":
            self._handle_speech_start(now)
        elif event.event_type == "speech_stop":
            self._handle_speech_stop(now)
        elif event.event_type == "interim_text" and event.text:
            self._handle_text(event.text, now)

        return self.snapshot(now)

    def snapshot(self, now_ms: Optional[float] = None) -> SpeechSnapshot:
        """Return the current acoustic snapshot without consuming an event."""
        if now_ms is None:
            now_ms = time.monotonic() * 1000

        current_silence = 0.0
        if self._silence_start_ms is not None and not self._is_speaking:
            current_silence = now_ms - self._silence_start_ms

        current_speech = 0.0
        if self._speech_start_ms is not None and self._is_speaking:
            current_speech = now_ms - self._speech_start_ms

        turn_dur = 0.0
        if self._turn_start_ms is not None:
            turn_dur = now_ms - self._turn_start_ms

        # WPM: count words in the last N seconds
        cutoff = now_ms - (self._WPM_WINDOW_SEC * 1000)
        recent_words = sum(1 for ts in self._word_timestamps if ts >= cutoff)
        wpm = (recent_words / self._WPM_WINDOW_SEC) * 60.0 if self._WPM_WINDOW_SEC > 0 else 0.0

        # Pause frequency: pauses per minute of speech
        total_speech_sec = self._total_speech_ms / 1000.0
        pause_freq = (self._pause_count / total_speech_sec) * 60.0 if total_speech_sec > 5.0 else 0.0

        return SpeechSnapshot(
            current_silence_ms=current_silence,
            current_speech_ms=current_speech,
            words_per_minute=wpm,
            pause_frequency=pause_freq,
            last_utterance_word_count=self._last_utterance_words,
            is_speaking=self._is_speaking,
            total_words_this_turn=self._total_words,
            turn_duration_ms=turn_dur,
        )

    # ── Internal handlers ──────────────────────────────────────────

    def _handle_speech_start(self, ts: float):
        if self._is_speaking:
            return  # Already speaking — ignore duplicate

        # Record the pause that just ended
        if self._silence_start_ms is not None:
            pause_dur = ts - self._silence_start_ms
            if pause_dur > 50:  # Ignore sub-50ms micro-silences
                self._pause_durations.append(pause_dur)
                self._pause_count += 1

        self._is_speaking = True
        self._speech_start_ms = ts
        self._silence_start_ms = None

    def _handle_speech_stop(self, ts: float):
        if not self._is_speaking:
            return  # Already silent

        # Record the speech burst that just ended
        if self._speech_start_ms is not None:
            speech_dur = ts - self._speech_start_ms
            self._speech_durations.append(speech_dur)
            self._total_speech_ms += speech_dur

        self._is_speaking = False
        self._silence_start_ms = ts
        self._speech_start_ms = None

    def _handle_text(self, text: str, ts: float):
        words = text.strip().split()
        word_count = len(words)
        self._last_utterance_words = word_count
        self._total_words += word_count
        for _ in words:
            self._word_timestamps.append(ts)

    # ── Derived metrics for downstream engines ─────────────────────

    @property
    def avg_pause_ms(self) -> float:
        """Average pause duration over the rolling window."""
        if not self._pause_durations:
            return 500.0  # Default assumption
        return sum(self._pause_durations) / len(self._pause_durations)

    @property
    def avg_speech_burst_ms(self) -> float:
        """Average speech burst duration."""
        if not self._speech_durations:
            return 2000.0
        return sum(self._speech_durations) / len(self._speech_durations)

    @property
    def recent_pauses(self) -> list[float]:
        """Return the last N pause durations."""
        return list(self._pause_durations)
