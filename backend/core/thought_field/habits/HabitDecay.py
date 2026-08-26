from .Habit import Habit
import time

class HabitDecay:
    @staticmethod
    def evaluate(habit: Habit) -> float:
        """
        Habits decay through elapsed time. Not conversation count.
        """
        elapsed = time.time() - habit.last_observed
        
        # Habits decay slowly if they were strong (stability protection)
        # It takes about 30 days of inactivity to lose 0.5 strength for a stable habit.
        decay_factor = 0.0
        if elapsed > 86400 * 3: # Grace period of 3 days
            base_decay_rate = 0.01 / 86400 # 0.01 per day
            effective_rate = base_decay_rate * (1.0 - (habit.stability * 0.8)) # Stability slows decay
            decay_factor = (elapsed - (86400 * 3)) * effective_rate
            
        new_strength = max(0.05, habit.strength - decay_factor)
        
        if habit.strength - new_strength > 0.1:
            habit.add_history("decayed", new_strength - habit.strength)
            
        return new_strength
