from .Value import Value

class ValueConfidence:
    @staticmethod
    def evaluate(value: Value, consistency: float, cross_subsystem_agreement: float) -> float:
        """
        Confidence depends on consistency and cross-subsystem agreement.
        It resists oscillation.
        """
        # If goals, habits, and relationship all point to this value, agreement is high.
        base_target = (consistency * 0.5) + (cross_subsystem_agreement * 0.5)
        
        # Stability protects confidence from dropping too fast
        if base_target < value.confidence:
            effective_lr = 0.05 * (1.0 - value.stability)
        else:
            effective_lr = 0.05
            
        new_confidence = value.confidence + (base_target - value.confidence) * effective_lr
        
        return max(0.1, min(0.95, new_confidence))
