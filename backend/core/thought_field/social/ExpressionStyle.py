from dataclasses import dataclass, field
from typing import Optional
import time

@dataclass(frozen=True)
class ExpressionStyle:
    mode_profile: str
    vocabulary_level: str
    sentence_length: str
    verbosity: str
    pacing: str
    directness: str
    warmth: str
    humor: str
    sarcasm: str
    profanity_tolerance: str
    conversational_energy: str
    challenge_level: str
    technical_depth: str
    interruption_style: str
    emotional_intensity: str
    adaptation_confidence: float
    timestamp: float = field(default_factory=time.time)
