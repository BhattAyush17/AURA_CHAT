"""
AURA Adaptive End-of-Turn Intelligence Pausing Module

A fully modular, provider-agnostic system that replaces fixed silence-based
turn detection with a learning system that adapts to each user's speaking
style, pause patterns, pacing, interruption behavior, and conversational context.

Operates independently of STT, LLM, and TTS providers.
"""

from .speech_analyzer import SpeechAnalyzer
from .profile_engine import UserSpeechProfile, UserSpeechProfileEngine
from .turn_confidence import TurnConfidenceEngine
from .context_layer import ConversationContextLayer, ConversationMode
from .interruption_learner import InterruptionLearner
from .response_timing import ResponseTimingEngine
from .orchestrator import AdaptiveTurnDetector

__all__ = [
    "AdaptiveTurnDetector",
    "SpeechAnalyzer",
    "UserSpeechProfile",
    "UserSpeechProfileEngine",
    "TurnConfidenceEngine",
    "ConversationContextLayer",
    "ConversationMode",
    "InterruptionLearner",
    "ResponseTimingEngine",
]
