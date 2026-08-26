import time
from dataclasses import dataclass, field

@dataclass(frozen=True)
class MonitoringState:
    long_term_confidence: float
    reflection_persistence: float
    reflection_resolution_rate: float
    identity_stability: float
    attention_drift: float
    curiosity_trend: float
    cognitive_fatigue: float
    oscillation_index: float
    monitor_confidence: float
    timestamp: float = field(default_factory=time.time)
