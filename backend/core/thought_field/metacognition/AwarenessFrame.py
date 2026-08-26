import time
from dataclasses import dataclass, field
from enum import Enum

class ContextTransition(Enum):
    NONE = 0
    TOPIC_SHIFT = 1
    EMOTIONAL_SHIFT = 2
    RELATIONSHIP_SHIFT = 3
    UNCERTAINTY_SHIFT = 4
    ATTENTION_SHIFT = 5
    REFLECTION_SHIFT = 6
    INSIGHT_SHIFT = 7
    GOAL_SHIFT = 8

@dataclass(frozen=True)
class AwarenessFrame:
    awareness_width: float
    attention_direction: str
    reflection_depth: float
    confidence: float
    uncertainty: float
    comfort: float
    emotional_momentum: float
    cognitive_load: float
    dominant_theme: str
    internal_tension: float
    awareness_density: float
    context_transition: ContextTransition = ContextTransition.NONE
    timestamp: float = field(default_factory=time.time)
