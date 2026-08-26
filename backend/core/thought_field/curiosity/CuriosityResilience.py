from .Curiosity import Curiosity

class CuriosityResilience:
    """
    Strong curiosities tolerate temporary certainty.

    When a short-term answer is found, a resilient curiosity survives
    because its deeper uncertainty has not been resolved — only a surface
    layer was satisfied. Later, deeper questions reactivate it.

    Resilience scales with inertia and persistence.
    """
    @staticmethod
    def evaluate(curiosity: Curiosity, certainty_spike: float) -> float:
        """
        certainty_spike: sudden reduction in epistemic uncertainty (0–1).
        High certainty_spike would normally crush pressure.
        Resilience buffers that effect.
        """
        base_resilience = (curiosity.inertia * 0.5) + (curiosity.persistence * 0.4) + (curiosity.confidence * 0.1)

        if certainty_spike > 0.3:
            # Under a strong certainty signal, resilience takes a mild hit
            target_resilience = max(0.1, base_resilience - (certainty_spike * 0.08))
        else:
            # Calm period slowly recovers resilience
            target_resilience = min(0.95, base_resilience + 0.01)

        new_resilience = curiosity.resilience + (target_resilience - curiosity.resilience) * 0.05
        return max(0.1, min(0.95, new_resilience))
