from dataclasses import dataclass, field
import time
from typing import List

@dataclass
class HabitHistoryEvent:
    event_type: str  # e.g., "formation_strengthened", "decayed", "dormancy_entered", "recovered", "evolved"
    impact: float
    timestamp: float = field(default_factory=time.time)

class HabitHistory:
    """
    Stores only the structural evolution of a habit.
    Never stores conversations or transcripts.
    """
    def __init__(self):
        self.events: List[HabitHistoryEvent] = []
        
    def add_event(self, event_type: str, impact: float = 0.0):
        self.events.append(HabitHistoryEvent(event_type=event_type, impact=impact))
