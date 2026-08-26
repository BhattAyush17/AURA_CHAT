from .Habit import Habit

class HabitSalience:
    @staticmethod
    def evaluate(habit: Habit, context_match: float) -> float:
        """
        Salience is current cognitive prominence, NOT strength.
        Fluctuates heavily based on current context.
        """
        # Baseline salience based on strength
        base_salience = habit.strength * 0.3
        
        # Context match dictates the rest
        target_salience = base_salience + (context_match * 0.7)
        
        # Salience adapts quickly
        new_salience = habit.salience + (target_salience - habit.salience) * 0.5
        
        return max(0.0, min(1.0, new_salience))
