from .Value import Value
import time

class ValueFormation:
    @staticmethod
    def evaluate_lifecycle(value: Value) -> str:
        """
        Evaluates the lifecycle state of a value.
        EMERGING -> FORMING -> STABLE -> REINFORCED -> QUESTIONED -> SHIFTING -> DORMANT -> EXTINCT
        """
        elapsed = time.time() - value.last_observed
        
        if value.lifecycle_state == "EXTINCT":
            return "EXTINCT"
            
        # Extreme decay over very long time (6 months)
        if value.strength < 0.05 and value.confidence < 0.1:
            if elapsed > 86400 * 180: 
                value.add_history("extinct", -1.0)
                return "EXTINCT"
            elif elapsed > 86400 * 30: # 1 month
                if value.lifecycle_state != "DORMANT":
                    value.add_history("dormancy_entered")
                return "DORMANT"
                
        # Normal states
        if value.strength > 0.8 and value.confidence > 0.8:
            return "REINFORCED"
            
        if value.strength > 0.6 and value.confidence > 0.6:
            return "STABLE"
            
        # If it's losing confidence but keeping strength, it is being questioned
        if value.strength > 0.5 and value.confidence < 0.4:
            return "QUESTIONED"
            
        # If it has high drift
        if value.drift > 0.6:
            return "SHIFTING"
            
        if value.strength > 0.3 and value.confidence > 0.3:
            return "FORMING"
            
        return "EMERGING"
