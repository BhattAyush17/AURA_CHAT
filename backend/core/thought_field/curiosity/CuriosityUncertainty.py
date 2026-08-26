from .Curiosity import Curiosity

class CuriosityUncertainty:
    """
    Uncertainty is the primary biological driver of curiosity.
    High certainty → lower curiosity.
    High uncertainty → higher curiosity growth.
    """
    @staticmethod
    def evaluate(curiosity: Curiosity, epistemic_uncertainty: float) -> float:
        """
        epistemic_uncertainty: degree of genuine unknowns derived from
        prediction confidence, reflection resolution rate, and monitoring
        oscillation index. Passed in as a normalised float (0–1).
        """
        target_uncertainty = epistemic_uncertainty

        # Smooth toward evidence quickly — uncertainty should respond faster than confidence
        new_uncertainty = curiosity.uncertainty + (target_uncertainty - curiosity.uncertainty) * 0.3
        return max(0.0, min(1.0, new_uncertainty))
