from .Goal import Goal

class GoalInertia:
    """
    Evaluates goal directional inertia.
    High inertia prevents single interactions or brief inactivity from completely derailing a goal.
    """
    @staticmethod
    def evaluate(goal: Goal, target_momentum: float) -> float:
        # Inertia is heavily coupled to commitment and importance
        base_inertia = (goal.commitment * 0.7) + (goal.importance * 0.3)
        
        current_momentum = goal.momentum
        
        # If continuing the same trajectory (either pushing forward or decaying)
        if (current_momentum > 0.5 and target_momentum > 0.5) or (current_momentum < 0.5 and target_momentum < 0.5):
            target_inertia = min(0.95, base_inertia + 0.1)
        else:
            # Reversing direction (e.g. suddenly working on a dead goal, or abandoning an active one)
            target_inertia = max(0.1, base_inertia - 0.1)
            
        # Optional: Add property inertia to the goal if it doesn't exist?
        # Actually, let's assume goal.inertia exists, or we just calculate the dynamic inertia.
        # Let's say inertia modifies the learning rate of momentum.
        return max(0.1, min(0.95, target_inertia))
