from .Habit import Habit

class HabitRecovery:
    @staticmethod
    def evaluate(habit: Habit, frequency_signal: float) -> float:
        """
        Tracks recovery capacity.
        Dormant habits recover faster than entirely new habits due to historical stability.
        """
        # If we are receiving frequency signals while the habit is weak/dormant,
        # recovery capacity dictates how fast it rebounds.
        target_recovery = habit.recovery_capacity
        
        if habit.lifecycle_state in ["REVIVING", "DORMANT"] and frequency_signal > 0:
            target_recovery = min(0.95, target_recovery + 0.05)
            
        # High historical stability increases recovery capacity
        if habit.stability > 0.7:
            target_recovery = max(target_recovery, 0.6)
            
        new_recovery = habit.recovery_capacity + (target_recovery - habit.recovery_capacity) * 0.1
        
        return max(0.1, min(0.95, new_recovery))
