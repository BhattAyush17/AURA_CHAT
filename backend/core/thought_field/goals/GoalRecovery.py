from .Goal import Goal

class GoalRecovery:
    """
    Tracks the historical capability to revive goals.
    Repeated successful revivals or momentum gains increase recovery.
    """
    @staticmethod
    def evaluate(goal: Goal, momentum_gain: float, momentum_drop: float) -> float:
        target_recovery = goal.recovery_capacity
        
        if momentum_gain > 0.05:
            # Rebounding
            target_recovery = min(0.95, target_recovery + 0.05)
        elif momentum_drop > 0.1:
            # Significant abandonment
            target_recovery = max(0.1, target_recovery - 0.02)
            
        new_recovery = goal.recovery_capacity + (target_recovery - goal.recovery_capacity) * 0.1
        
        return max(0.1, min(0.95, new_recovery))
