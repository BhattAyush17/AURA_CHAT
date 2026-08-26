from .Goal import Goal
import time

class GoalMomentum:
    @staticmethod
    def evaluate(goal: Goal, activity_strength: float) -> float:
        """
        Momentum measures forward movement.
        Decays with elapsed time. Increases with activity.
        """
        target_momentum = goal.momentum
        elapsed = time.time() - goal.last_updated
        
        # Decay: 1 week of inactivity zeroes out momentum
        if elapsed > 0:
            decay = min(0.5, (elapsed / (86400 * 7)) * 0.5)
            target_momentum = max(0.0, target_momentum - decay)
            
        # Activity boosts momentum
        if activity_strength > 0:
            target_momentum = min(1.0, target_momentum + (activity_strength * 0.2))
            
        new_momentum = goal.momentum + (target_momentum - goal.momentum) * 0.1
        
        if abs(new_momentum - goal.momentum) > 0.2:
            goal.add_history("momentum_changed", new_momentum - goal.momentum)
            
        return max(0.0, min(1.0, new_momentum))
