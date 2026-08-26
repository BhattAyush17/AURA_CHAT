from .Habit import Habit
import time

class HabitConfidence:
    @staticmethod
    def evaluate(habit: Habit, consistency_signal: float) -> float:
        """
        Confidence measures how certain AURA is that the pattern is genuine.
        Evolves independently of strength.
        """
        target_confidence = habit.confidence
        elapsed_total = time.time() - habit.created_time
        
        # Long-term survival increases confidence regardless of strength
        time_factor = min(0.5, elapsed_total / (86400 * 90)) # Up to 0.5 confidence just for surviving 3 months
        
        if consistency_signal > 0.5:
            target_confidence = min(0.95, target_confidence + 0.1)
        elif consistency_signal < 0.2:
            target_confidence = max(0.1, target_confidence - 0.05)
            
        target_confidence = max(target_confidence, time_factor)
        
        new_confidence = habit.confidence + (target_confidence - habit.confidence) * 0.05
        
        return max(0.1, min(0.95, new_confidence))
