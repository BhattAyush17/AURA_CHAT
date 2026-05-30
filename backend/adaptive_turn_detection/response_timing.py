"""
Component 6: Response Timing Engine

Generates human-like response delays with controlled randomness.
Upgraded with Personality Timing Bias to replace random jitter.
"""

import random
from .context_layer import ConversationMode
from .profile_engine import UserSpeechProfile


class ResponseTimingEngine:
    """
    Generates natural response delays with per-mode baselines,
    user profile influence, personality bias, and small randomness.
    """

    # Base delays per mode (ms)
    _BASE = {
        ConversationMode.COMMAND:      100,
        ConversationMode.QUESTION:     150,
        ConversationMode.DISCUSSION:   250,
        ConversationMode.STORYTELLING: 350,
        ConversationMode.EMOTIONAL:    500,
        ConversationMode.REFLECTIVE:   500,
    }
    
    _PERSONALITY_BIAS = {
        "supportive": 100,
        "playful": -50,
        "reflective": 150,
        "assistant": 0,
        "joyful_passion": -50,
        "chaotic": -100,
    }

    # Small jitter range as fraction of base delay (reduced due to bias usage)
    _JITTER_FRACTION = 0.10

    def get_response_delay(
        self,
        mode: ConversationMode,
        profile: UserSpeechProfile,
        emotional_intensity: float = 0.0,
        personality: str = "assistant",
    ) -> int:
        """
        Calculate a human-like response delay in milliseconds.
        """
        base = self._BASE.get(mode, 250)

        # Patient users expect slightly longer delays
        patience_scale = 1.0 + (profile.response_patience - 0.5) * 0.4
        base = base * patience_scale

        # Emotional moments → add breathing room
        if emotional_intensity > 0.5:
            base += (emotional_intensity - 0.5) * 300
            
        # Add personality bias
        bias = self._PERSONALITY_BIAS.get(personality, 0)
        base += bias

        # Add small controlled randomness
        jitter = base * self._JITTER_FRACTION
        delay = base + random.uniform(-jitter, jitter)

        # Clamp to sane range
        delay = max(10, min(800, delay))

        return int(delay)
