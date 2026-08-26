from typing import List
from .Value import Value

class ValueConflict:
    @staticmethod
    def evaluate(active_values: List[Value], tension_signal: float) -> float:
        """
        Evaluates the tension/conflict across active values.
        Redistributes salience (handled externally).
        """
        if len(active_values) < 2:
            return 0.0
            
        # Conflict rises if multiple strong values are simultaneously highly salient
        # but tension_signal suggests they are competing.
        high_salience_values = [v for v in active_values if v.salience > 0.7]
        
        conflict = 0.0
        
        if len(high_salience_values) > 1 and tension_signal > 0.5:
            conflict += tension_signal * 0.5 * (len(high_salience_values) - 1)
            
        return max(0.0, min(1.0, conflict))
