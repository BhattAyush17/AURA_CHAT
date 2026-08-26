from .Value import Value

class ValueSalience:
    @staticmethod
    def evaluate(value: Value, contextual_relevance: float, conflict_pressure: float) -> float:
        """
        Salience is temporary and fluctuates based on context and conflict.
        Conflict redistributes salience.
        """
        # Baseline salience tied slightly to strength
        base_salience = value.strength * 0.4
        
        target_salience = base_salience + (contextual_relevance * 0.6)
        
        # Conflict pressure reduces the salience of non-dominant values temporarily
        target_salience = max(0.0, target_salience - (conflict_pressure * 0.3))
        
        # Adapts quickly
        new_salience = value.salience + (target_salience - value.salience) * 0.3
        
        return max(0.0, min(1.0, new_salience))
