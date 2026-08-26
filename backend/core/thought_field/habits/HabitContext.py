from .Habit import Habit
from typing import Dict

class HabitContext:
    @staticmethod
    def update_affinity(habit: Habit, current_context: Dict[str, str]):
        """
        Updates the contextual affinity of the habit.
        """
        # Context is just a string-based frequency map for simplicity
        for key, value in current_context.items():
            composite_key = f"{key}:{value}"
            if composite_key not in habit.context_affinity:
                habit.context_affinity[composite_key] = 0.0
            habit.context_affinity[composite_key] += 0.1
            
        # Normalize
        total = sum(habit.context_affinity.values())
        if total > 0:
            for k in habit.context_affinity:
                habit.context_affinity[k] /= total
                
    @staticmethod
    def evaluate_match(habit: Habit, current_context: Dict[str, str]) -> float:
        """
        Returns how well the current context matches the habit's affinity.
        """
        if not habit.context_affinity:
            return 0.5 # Neutral if no strong context yet
            
        match_score = 0.0
        for key, value in current_context.items():
            composite_key = f"{key}:{value}"
            match_score += habit.context_affinity.get(composite_key, 0.0)
            
        return min(1.0, match_score)
