from .Value import Value

class ValueResilience:
    """
    Computes how well an established value tolerates temporary contradictions.
    
    A long-established value (high stability, high confidence) remains largely
    intact during periods of inconsistency, mirroring human experience where
    core motivational priorities survive short-term disruption.
    """
    @staticmethod
    def evaluate(value: Value, contradiction: float) -> float:
        # Resilience is seeded by how deeply established the value is
        base_resilience = (value.confidence * 0.5) + (value.stability * 0.3) + (value.recovery_capacity * 0.2)

        if contradiction > 0.3:
            # Under significant contradiction, resilience absorbs the blow but takes a small hit
            target_resilience = max(0.1, base_resilience - (contradiction * 0.1))
        else:
            # Stability slowly increases resilience during periods of calm
            target_resilience = min(0.95, base_resilience + 0.01)

        new_resilience = value.resilience + (target_resilience - value.resilience) * 0.05
        return max(0.1, min(0.95, new_resilience))
