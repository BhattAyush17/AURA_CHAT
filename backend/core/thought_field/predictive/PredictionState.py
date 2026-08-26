import time
from dataclasses import dataclass, field
from typing import Optional

@dataclass(frozen=True)
class PredictionState:
    expected_attention: str
    expected_reflection: str
    expected_emotional_momentum: str
    expected_identity_pressure: str
    expected_curiosity: str
    expected_open_loop_return: Optional[str]
    prediction_confidence: float
    prediction_stability: float
    prediction_timestamp: float = field(default_factory=time.time)
