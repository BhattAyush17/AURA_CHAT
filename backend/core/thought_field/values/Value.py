from dataclasses import dataclass, field
import time
from .ValueHistory import ValueHistory

@dataclass
class Value:
    """
    Represents a persistent motivational priority.
    """
    id: str
    theme: str
    
    # Core attributes
    strength: float = 0.1
    confidence: float = 0.1
    salience: float = 0.1
    stability: float = 0.1
    consistency: float = 0.5
    drift: float = 0.0
    
    # Stabilization attributes (Phase 5.9A)
    inertia: float = 0.5           # Resistance to sudden change
    resilience: float = 0.1        # Tolerance of temporary contradictions
    recovery_capacity: float = 0.5 # Historical speed of recovery from dormancy
    hierarchy_depth: int = 0       # Depth in the value influence hierarchy (0 = root)
    
    # Lifecycle
    lifecycle_state: str = "EMERGING" # EMERGING, FORMING, STABLE, REINFORCED, QUESTIONED, SHIFTING, DORMANT, EXTINCT
    
    # Tracking
    created_time: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)
    last_observed: float = field(default_factory=time.time)
    history: ValueHistory = field(default_factory=ValueHistory)
    
    def add_history(self, event_type: str, impact: float = 0.0):
        self.history.add_event(event_type=event_type, impact=impact)
