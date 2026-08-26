from dataclasses import dataclass

@dataclass
class ThoughtAffinity:
    identity: float = 0.0
    reflection: float = 0.0
    novelty: float = 0.0
    relationship: float = 0.0
    curiosity: float = 0.0
    comfort: float = 0.0
    urgency: float = 0.0
    attention: float = 0.0

    def get_environmental_resonance(self, env_fields: dict) -> float:
        # Measure how well this affinity matches the current environmental fields
        resonance = 0.0
        for key, val in env_fields.items():
            if hasattr(self, key):
                affinity_val = getattr(self, key)
                resonance += (val.intensity * affinity_val)
        return resonance
