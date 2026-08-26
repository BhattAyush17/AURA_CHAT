import time
from dataclasses import dataclass, field
from .AwarenessFrame import ContextTransition

@dataclass(frozen=True)
class ReflectionState:
    # --- Core Trajectories ---
    certainty_direction: str # "weakening", "strengthening", "stable"
    attention_pattern: str # "scattered", "narrowing", "wandering", "stable"
    emotional_direction: str # "settling", "escalating", "stable"
    
    # --- Raw Metrics ---
    unresolvedness: float
    identity_pressure: float
    reflection_depth: float
    internal_stability: float
    dominant_transition: ContextTransition
    
    # --- Structural Maturation (Added in 5.3.2A) ---
    lifecycle_stage: str # "Emerging", "Growing", "Stable", "Settling", "Resolved", "Archived"
    confidence: float
    coherence: str # "Stable", "Conflicted", "Fragmented", "Converging"
    recurrence_strength: float
    
    timestamp: float = field(default_factory=time.time)
