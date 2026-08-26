from .Curiosity import Curiosity

class CuriosityInertia:
    """
    Long-lived curiosities resist disappearance.

    Inertia accumulates from:
    - Repeated recurrence (activation count)
    - High persistence
    - Deep resolution progress (showing genuine investment)

    A temporary resolution signal cannot collapse an inertia-hardened curiosity.
    """
    @staticmethod
    def evaluate(curiosity: Curiosity, recurrence_norm: float) -> float:
        # Inertia is anchored to persistence and recurrence — both are slow-moving
        base_inertia = (curiosity.persistence * 0.5) + (recurrence_norm * 0.3) + (curiosity.confidence * 0.2)

        # Partial resolution signals a genuine effort — actually increases inertia slightly
        # (curiosity survives because it deepened, not because it was abandoned)
        if curiosity.resolution > 0.3 and curiosity.resolution < 0.9:
            base_inertia = min(0.95, base_inertia + 0.05)

        # Inertia itself is structural — moves slowly
        new_inertia = curiosity.inertia + (base_inertia - curiosity.inertia) * 0.05
        return max(0.1, min(0.95, new_inertia))
