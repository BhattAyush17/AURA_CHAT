from .Curiosity import Curiosity

class CuriosityPersistence:
    """
    Persistence measures how strongly a curiosity resists decay.

    Depends on:
    - Goal relevance (goal-linked curiosity persists longer)
    - Value alignment (value-anchored curiosity persists longer)
    - Recurrence (repeatedly activated curiosity earns persistence)
    """
    @staticmethod
    def evaluate(
        curiosity: Curiosity,
        goal_relevance: float,
        value_alignment: float,
        recurrence_signal: float,  # how many times this curiosity was reactivated (normalised 0–1)
    ) -> float:
        target_persistence = (
            goal_relevance    * 0.35
            + value_alignment * 0.35
            + recurrence_signal * 0.30
        )

        # Persistence is structural — moves slowly
        new_persistence = curiosity.persistence + (target_persistence - curiosity.persistence) * 0.05
        return max(0.0, min(1.0, new_persistence))
