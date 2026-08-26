from .Curiosity import Curiosity
import time

class CuriosityDecay:
    """
    Curiosity pressure decays through elapsed time.
    
    Resolved curiosity → pressure decays quickly.
    Ignored curiosity → pressure slowly weakens.
    High-persistence, important curiosity → decays much slower.
    
    Decay is continuous and time-based — never conversation-count-based.
    """
    @staticmethod
    def apply(curiosity: Curiosity) -> float:
        """Returns the new pressure after applying time-based decay."""
        elapsed = time.time() - curiosity.last_activated

        if elapsed < 3600:  # < 1 hour: essentially no decay
            return curiosity.pressure

        # Base decay rate: a fully non-persistent curiosity loses ~50% pressure per day
        base_rate = 0.5 / 86400

        # Persistence strongly retards decay (high persistence → near-zero decay)
        effective_rate = base_rate * (1.0 - (curiosity.persistence * 0.9))

        # Resolution accelerates decay
        if curiosity.resolution > 0.5:
            effective_rate *= (1.0 + curiosity.resolution)

        decay_amount = elapsed * effective_rate
        new_pressure = max(0.0, curiosity.pressure - decay_amount)

        if curiosity.pressure - new_pressure > 0.1:
            curiosity.add_history("decayed", new_pressure - curiosity.pressure)

        return new_pressure
