from .Curiosity import Curiosity

class CuriosityNovelty:
    """
    Novelty measures how unfamiliar the unresolved space is.
    High novelty increases curiosity pressure.
    Repeated exposure naturally declines novelty.
    Novelty is independent of pressure.
    """
    @staticmethod
    def evaluate(curiosity: Curiosity, exposure_count: float) -> float:
        """
        exposure_count: how many times this domain has been revisited (normalised 0–1).
        Higher exposure → lower novelty.
        """
        # Novelty decays logarithmically with exposure
        decay = min(0.8, exposure_count * 0.2)
        target_novelty = max(0.05, curiosity.novelty - decay)

        new_novelty = curiosity.novelty + (target_novelty - curiosity.novelty) * 0.1
        return max(0.05, min(1.0, new_novelty))
