from .Habit import Habit
import time

class HabitFormation:
    @staticmethod
    def evaluate_lifecycle(habit: Habit) -> str:
        """
        Evaluates the lifecycle state of a habit based on strength, confidence, and recency.
        DISCOVERING -> FORMING -> ESTABLISHED -> STABLE -> WEAKENING -> DORMANT -> REVIVING -> EXTINCT
        """
        elapsed = time.time() - habit.last_observed
        
        # If extinct, it never comes back
        if habit.lifecycle_state == "EXTINCT":
            return "EXTINCT"
            
        # Severe decay
        if habit.strength < 0.05 and habit.confidence < 0.1:
            if elapsed > 86400 * 90: # 3 months of inactivity
                habit.add_history("extinct", -1.0)
                return "EXTINCT"
            elif elapsed > 86400 * 14: # 2 weeks of inactivity
                if habit.lifecycle_state != "DORMANT":
                    habit.add_history("dormancy_entered")
                return "DORMANT"
                
        # Recovery phase
        if habit.lifecycle_state == "DORMANT" and habit.strength > 0.1:
            habit.add_history("recovered", 0.5)
            return "REVIVING"
            
        # Normal progression
        if habit.strength > 0.8 and habit.confidence > 0.8:
            return "STABLE"
            
        if habit.strength > 0.5 and habit.confidence > 0.5:
            return "ESTABLISHED"
            
        if habit.strength > 0.2 and habit.confidence > 0.2:
            return "FORMING"
            
        # If it's decaying
        if habit.lifecycle_state in ["STABLE", "ESTABLISHED"] and habit.strength < 0.4:
            return "WEAKENING"
            
        return "DISCOVERING"
