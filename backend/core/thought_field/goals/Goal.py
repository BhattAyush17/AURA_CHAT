from dataclasses import dataclass, field
import time
from .GoalHistory import GoalHistory

@dataclass
class Goal:
    """
    Represents one persistent life direction.
    """
    id: str
    theme: str
    
    # Core attributes
    confidence: float = 0.1
    momentum: float = 0.5
    importance: float = 0.1
    commitment: float = 0.1
    progress: float = 0.0
    
    # Stabilization attributes
    inertia: float = 0.5
    resilience: float = 0.1
    recovery_capacity: float = 0.5
    
    # State string
    lifecycle_state: str = "PROPOSED" # PROPOSED, FORMING, ACTIVE, STABLE, DORMANT, REVIVED, FULFILLED, ABANDONED
    
    # Alignments
    identity_alignment: float = 0.5
    relationship_alignment: float = 0.5
    
    # Tracking
    created_time: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)
    history: GoalHistory = field(default_factory=GoalHistory)
    
    def add_history(self, event_type: str, impact: float = 0.0):
        self.history.add_event(event_type=event_type, impact=impact)
