from .Value import Value

class ValueRecovery:
    """
    Tracks the historical capacity of a value to revive from dormancy.
    
    Dormant values recover faster than entirely new values because the
    underlying motivational trace remains. Each successful revival
    permanently raises the recovery capacity ceiling.
    """
    @staticmethod
    def evaluate(value: Value, strength_gain: float, strength_loss: float) -> float:
        target_recovery = value.recovery_capacity

        if value.lifecycle_state in ["DORMANT"] and strength_gain > 0.01:
            # Successful revival: recovery capacity earns a lasting reward
            target_recovery = min(0.95, target_recovery + 0.08)
        elif strength_loss > 0.1:
            # Major sustained loss slowly erodes recovery capacity
            target_recovery = max(0.1, target_recovery - 0.02)

        # High historical stability guarantees a floor
        if value.stability > 0.6:
            target_recovery = max(target_recovery, 0.5)

        new_recovery = value.recovery_capacity + (target_recovery - value.recovery_capacity) * 0.1
        return max(0.1, min(0.95, new_recovery))
