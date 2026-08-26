from .Goal import Goal

class GoalResilience:
    """
    Evaluates how effectively a goal bounces back from contradiction or abandonment.
    Tied to historical commitment and recovery capacity.
    """
    @staticmethod
    def evaluate(goal: Goal, momentum_drop: float) -> float:
        base_resilience = (goal.commitment * 0.6) + (goal.recovery_capacity * 0.4)
        
        # Massive momentum drop reduces resilience temporarily
        if momentum_drop > 0.1:
            target_resilience = max(0.1, base_resilience - (momentum_drop * 0.5))
        else:
            target_resilience = min(0.95, base_resilience + 0.01)
            
        new_resilience = goal.resilience + (target_resilience - goal.resilience) * 0.05
        
        return max(0.1, min(0.95, new_resilience))
