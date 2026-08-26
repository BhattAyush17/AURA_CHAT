from .Goal import Goal
import time

class GoalDormancy:
    @staticmethod
    def evaluate(goal: Goal) -> str:
        """
        Evaluates the lifecycle state of a goal.
        PROPOSED -> FORMING -> ACTIVE -> STABLE -> DORMANT -> REVIVED -> FULFILLED | ABANDONED
        """
        # If goal is already terminal, do not change
        if goal.lifecycle_state in ["FULFILLED", "ABANDONED"]:
            return goal.lifecycle_state
            
        if goal.progress > 0.95:
            goal.add_history("fulfilled", 1.0)
            return "FULFILLED"
            
        if goal.confidence < 0.1 and goal.commitment < 0.1 and goal.momentum < 0.1:
            elapsed = time.time() - goal.last_updated
            # Abandoned if zero momentum/confidence for over 30 days
            if elapsed > 86400 * 30:
                goal.add_history("abandoned", -1.0)
                return "ABANDONED"
            
        if goal.momentum < 0.1:
            if goal.lifecycle_state != "DORMANT":
                goal.add_history("dormancy_entered")
            return "DORMANT"
            
        if goal.lifecycle_state == "DORMANT" and goal.momentum > 0.3:
            goal.add_history("revived", 0.5)
            return "REVIVED"
            
        if goal.momentum > 0.7 and goal.confidence > 0.7:
            return "STABLE"
            
        if goal.momentum > 0.4 and goal.confidence > 0.4:
            return "ACTIVE"
            
        if goal.confidence > 0.2:
            return "FORMING"
            
        return "PROPOSED"
