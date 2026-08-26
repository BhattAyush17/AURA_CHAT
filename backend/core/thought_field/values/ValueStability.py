from .Value import Value
import time

class ValueStability:
    @staticmethod
    def evaluate(value: Value) -> float:
        """
        Stability grows with age, consistency, and reinforcement.
        """
        elapsed = time.time() - value.created_time
        
        # Max stability bonus for age is reached after ~1 year (31536000 seconds), 
        # but for simulation we can say 90 days.
        age_factor = min(0.4, elapsed / (86400 * 90))
        
        # Consistency and confidence form the rest
        performance_factor = (value.consistency * 0.3) + (value.confidence * 0.3)
        
        target_stability = age_factor + performance_factor
        
        # Moves very slowly
        new_stability = value.stability + (target_stability - value.stability) * 0.05
        
        return max(0.1, min(0.95, new_stability))
