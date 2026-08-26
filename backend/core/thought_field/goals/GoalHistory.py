from dataclasses import dataclass, field
import time
from typing import List

@dataclass
class GoalHistoryEvent:
    event_type: str  # e.g., "momentum_changed", "confidence_changed", "dormancy_entered"
    impact: float
    timestamp: float = field(default_factory=time.time)

class GoalHistory:
    """
    Stores only the structural evolution of a goal.
    Never stores conversations or transcripts.
    """
    def __init__(self):
        self.events: List[GoalHistoryEvent] = []
        
    def add_event(self, event_type: str, impact: float = 0.0):
        self.events.append(GoalHistoryEvent(event_type=event_type, impact=impact))
