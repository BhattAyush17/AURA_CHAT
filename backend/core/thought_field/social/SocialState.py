import time
from dataclasses import dataclass, field

@dataclass(frozen=True)
class SocialState:
    engagement_estimate: float
    openness_estimate: float
    hesitation_estimate: float
    emotional_bandwidth_estimate: float
    cognitive_bandwidth_estimate: float
    conversation_energy_estimate: float
    humor_receptivity_estimate: float
    challenge_receptivity_estimate: float
    silence_receptivity_estimate: float
    comfort_estimate: float
    estimated_social_load: float
    uncertainty_estimate: float
    perception_confidence: float
    observations: list = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)
