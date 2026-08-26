from .Habit import Habit

class HabitStrength:
    @staticmethod
    def evaluate(habit: Habit, frequency_signal: float, consistency_signal: float) -> float:
        """
        Strength measures how deeply embedded the routine is.
        It builds very slowly based on consistent repetition.
        """
        target_strength = habit.strength
        
        # Consistent repetition increases target strength
        if frequency_signal > 0 and consistency_signal > 0.5:
            target_strength = min(0.95, target_strength + (consistency_signal * 0.1))
            
        # Slow learning rate for strength (takes many interactions)
        new_strength = habit.strength + (target_strength - habit.strength) * 0.05
        
        # Decay is handled by HabitDecay separately, but if frequency_signal == 0, we do not increase.
        
        if abs(new_strength - habit.strength) > 0.1:
            habit.add_history("strength_changed", new_strength - habit.strength)
            
        return max(0.05, min(0.95, new_strength))
