from dataclasses import dataclass, field
import time
from .HabitHistory import HabitHistory

@dataclass
class Habit:
    """
    Represents one recurring behavioural pattern.
    """
    id: str
    theme: str
    
    # Core attributes
    strength: float = 0.1
    confidence: float = 0.1
    salience: float = 0.1
    frequency: float = 0.1
    stability: float = 0.1
    
    # Stabilization attributes
    recovery_capacity: float = 0.5
    
    # State string
    lifecycle_state: str = "DISCOVERING" # DISCOVERING, FORMING, ESTABLISHED, STABLE, WEAKENING, DORMANT, REVIVING, EXTINCT
    
    # Context (e.g. time of day, category)
    context_affinity: dict = field(default_factory=dict)
    
    # Tracking
    created_time: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)
    last_observed: float = field(default_factory=time.time)
    history: HabitHistory = field(default_factory=HabitHistory)
    
    def add_history(self, event_type: str, impact: float = 0.0):
        self.history.add_event(event_type=event_type, impact=impact)
