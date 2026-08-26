from dataclasses import dataclass, field
import time

@dataclass(frozen=True)
class SocialModelState:
    """
    Immutable representation of AURA's long-term understanding of the human.
    These are stable beliefs about the person's preferences, NOT transient states.
    """
    humor_preference: float = 0.5
    challenge_preference: float = 0.5
    explanation_depth_preference: float = 0.5
    conversation_energy_preference: float = 0.5
    formality_preference: float = 0.5
    directness_preference: float = 0.5
    verbosity_preference: float = 0.5
    emotional_validation_preference: float = 0.5
    technical_density_preference: float = 0.5
    silence_comfort_preference: float = 0.5
    conversation_pace_preference: float = 0.5
    curiosity_level_preference: float = 0.5
    playfulness_preference: float = 0.5
    reflection_depth_preference: float = 0.5
    
    relationship_comfort: float = 0.5
    trust_stability: float = 0.5
    conversation_predictability: float = 0.5
    
    model_confidence: float = 0.0
    timestamp: float = field(default_factory=time.time)
