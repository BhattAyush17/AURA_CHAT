from .Value import Value

class ValueStrength:
    @staticmethod
    def evaluate(value: Value, reinforcement: float, contradiction: float) -> float:
        """
        Strength measures how deeply embedded the value has become.
        Grows extremely slowly based on repeated cross-subsystem convergence.
        """
        target_strength = value.strength
        
        if reinforcement > 0:
            target_strength = min(0.95, target_strength + (reinforcement * 0.05))
            
        if contradiction > 0:
            target_strength = max(0.05, target_strength - (contradiction * 0.1))
            
        new_strength = value.strength + (target_strength - value.strength) * 0.02 # Extremely slow lr
        
        if abs(new_strength - value.strength) > 0.05:
            value.add_history("strength_changed", new_strength - value.strength)
            
        return max(0.05, min(0.95, new_strength))
