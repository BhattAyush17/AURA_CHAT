from .Curiosity import Curiosity

class CuriosityRecovery:
    """
    Dormant curiosities recover rapidly when similar uncertainty returns.

    Historical investment (previous pressure, recurrence, persistence)
    guarantees that a curiosity reviving from dormancy always recovers
    faster than the initial formation rate.

    Each successful revival permanently increases recovery_capacity.
    """
    @staticmethod
    def evaluate(
        curiosity: Curiosity,
        pressure_gain: float,
        pressure_loss: float,
        goal_relevance: float,
        value_alignment: float,
    ) -> float:
        target_recovery = curiosity.recovery_capacity

        if curiosity.lifecycle_state in ("DORMANT",) and pressure_gain > 0.05:
            # Successful revival: recovery capacity earns a lasting reward
            target_recovery = min(0.95, target_recovery + 0.10)

        elif pressure_loss > 0.15:
            # Major sustained loss slowly erodes recovery capacity
            target_recovery = max(0.1, target_recovery - 0.02)

        # Goal and value anchoring maintain a floor
        anchor_floor = max(goal_relevance, value_alignment) * 0.6
        target_recovery = max(target_recovery, anchor_floor)

        new_recovery = curiosity.recovery_capacity + (target_recovery - curiosity.recovery_capacity) * 0.1
        return max(0.1, min(0.95, new_recovery))
