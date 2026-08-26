from typing import List, Dict
from .Goal import Goal

class GoalConflict:
    @staticmethod
    def evaluate(active_goals: List[Goal]) -> float:
        """
        Evaluates the tension/conflict across active goals.
        Returns a conflict level between 0.0 and 1.0.
        """
        if len(active_goals) < 2:
            return 0.0
            
        # Simplistic conflict model: If multiple goals have high importance and high momentum,
        # tension increases because resources (time/energy) are split.
        high_momentum_goals = [g for g in active_goals if g.momentum > 0.7]
        high_importance_goals = [g for g in active_goals if g.importance > 0.7]
        
        conflict = 0.0
        
        # Too many high momentum goals = high tension
        if len(high_momentum_goals) > 2:
            conflict += (len(high_momentum_goals) - 2) * 0.1
            
        # Too many high importance goals = high baseline pressure
        if len(high_importance_goals) > 3:
            conflict += (len(high_importance_goals) - 3) * 0.05
            
        return max(0.0, min(1.0, conflict))
