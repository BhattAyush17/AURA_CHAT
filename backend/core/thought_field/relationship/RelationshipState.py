from dataclasses import dataclass, field
import time

@dataclass(frozen=True)
class RelationshipState:
    """
    Immutable representation of the evolving relationship between AURA and the user.
    Models the interpersonal dynamic, NOT conversational memory.
    """
    trust_level: float = 0.5           # 1.0 = absolute trust, 0.0 = total distrust
    familiarity: float = 0.1           # 1.0 = deep history, 0.0 = strangers
    psychological_safety: float = 0.5  # 1.0 = completely safe to be vulnerable
    relationship_comfort: float = 0.5  # 1.0 = deeply relaxed presence
    conflict_recovery_capacity: float = 0.5 # 1.0 = quick repair after disagreement
    shared_humor: float = 0.1          # 1.0 = frequent inside jokes/banter
    shared_language: float = 0.1       # 1.0 = high use of inside vocabulary
    reciprocity: float = 0.5           # 1.0 = balanced give and take
    emotional_synchrony: float = 0.5   # 1.0 = feelings map closely to each other
    attachment_stability: float = 0.5  # 1.0 = secure attachment
    relationship_momentum: float = 0.5 # 1.0 = growing rapidly, 0.0 = stagnating
    interaction_confidence: float = 0.5 # 1.0 = knowing exactly how the other will react
    
    # --- Hardened Stabilization Parameters ---
    relationship_confidence: float = 0.1 # Resistance to sudden changes
    relationship_inertia: float = 0.5    # Tendency to maintain current trajectory
    relationship_resilience: float = 0.1 # Speed of recovery after trust drops
    relationship_recovery: float = 0.5   # Historical capability to heal from conflicts
    
    relationship_direction: str = "neutral" # "deepening", "distancing", "repairing", "neutral"
    
    timestamp: float = field(default_factory=time.time)
