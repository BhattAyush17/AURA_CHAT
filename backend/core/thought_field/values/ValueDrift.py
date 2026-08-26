from .Value import Value

class ValueDrift:
    @staticmethod
    def evaluate(value: Value, thematic_shift_signal: float) -> float:
        """
        Drift measures how much a value is evolving over time.
        If a value drifts too much, it enters the SHIFTING state.
        """
        target_drift = value.drift
        
        if thematic_shift_signal > 0.5:
            target_drift = min(1.0, target_drift + (thematic_shift_signal * 0.1))
        else:
            # Gradually decays if stable
            target_drift = max(0.0, target_drift - 0.05)
            
        new_drift = value.drift + (target_drift - value.drift) * 0.1
        
        if abs(new_drift - value.drift) > 0.2:
            value.add_history("drifted", new_drift - value.drift)
            
        return max(0.0, min(1.0, new_drift))
