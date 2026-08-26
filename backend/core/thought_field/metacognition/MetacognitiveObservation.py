import time
from dataclasses import dataclass, field

@dataclass(frozen=True)
class MetacognitiveObservation:
    observation_type: str # e.g., "SustainedFocus", "ScatteredAttention", "PersistentTension", "StableCertainty"
    confidence: float
    intensity: float
    summary: str
    emotional_context: str
    timestamp: float = field(default_factory=time.time)

    def to_dict(self):
        return {
            "observation_type": self.observation_type,
            "confidence": round(self.confidence, 3),
            "intensity": round(self.intensity, 3),
            "summary": self.summary,
            "emotional_context": self.emotional_context,
            "timestamp": self.timestamp
        }
