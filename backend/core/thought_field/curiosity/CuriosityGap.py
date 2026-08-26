from .Curiosity import Curiosity

class CuriosityGap:
    """
    Information Gap: curiosity emerges from the distance between
    current understanding and desired understanding.

    Gap is mathematical — not linguistic.
    Gap closes gradually through resolution signals.
    """
    @staticmethod
    def current_gap(curiosity: Curiosity) -> float:
        """Returns the normalised gap size: 1.0 = fully open, 0.0 = closed."""
        return max(0.0, 1.0 - curiosity.resolution)

    @staticmethod
    def apply_resolution(curiosity: Curiosity, resolution_delta: float) -> float:
        """
        Partially closes the gap.
        resolution_delta is bounded [0, 1]. Closing is incremental — never instant.
        """
        # Max closing rate per tick: 5% regardless of input delta
        effective_delta = min(resolution_delta, 0.05)
        new_resolution = min(1.0, curiosity.resolution + effective_delta)

        if new_resolution > curiosity.resolution + 0.1:
            curiosity.add_history("gap_closed", new_resolution - curiosity.resolution)

        return new_resolution
