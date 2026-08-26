from .Curiosity import Curiosity
from .CuriosityGap import CuriosityGap

class CuriosityPressure:
    """
    Pressure represents how strongly cognition is pulled toward a curiosity.

    Increases with: uncertainty, novelty, gap size, value/goal alignment.
    Decreases with: resolution, repeated exposure, time passage.
    """
    @staticmethod
    def evaluate(
        curiosity: Curiosity,
        value_alignment: float,   # 0–1: how much active values support this curiosity
        goal_relevance: float,    # 0–1: how much active goals support this curiosity
    ) -> float:
        gap = CuriosityGap.current_gap(curiosity)

        # Pressure grows from uncertainty × novelty × gap (multiplicative core)
        raw_pressure = (
            curiosity.uncertainty * 0.35
            + curiosity.novelty   * 0.25
            + gap                 * 0.20
            + value_alignment     * 0.10
            + goal_relevance      * 0.10
        )

        # Smooth toward raw target; pressure should be reactive but not jittery
        new_pressure = curiosity.pressure + (raw_pressure - curiosity.pressure) * 0.2

        prev = curiosity.pressure
        if abs(new_pressure - prev) > 0.15:
            curiosity.add_history("pressure_rose" if new_pressure > prev else "pressure_fell",
                                  new_pressure - prev)

        return max(0.0, min(1.0, new_pressure))
