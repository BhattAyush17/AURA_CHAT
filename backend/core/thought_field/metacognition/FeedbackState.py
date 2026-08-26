import time
from dataclasses import dataclass, field
from typing import Dict

@dataclass(frozen=True)
class FeedbackState:
    feedback_strength: float
    feedback_direction: str # "stabilizing", "energizing", "calming", "neutral"
    regulated_parameters: Dict[str, float]
    stability: float
    confidence: float
    timestamp: float = field(default_factory=time.time)
