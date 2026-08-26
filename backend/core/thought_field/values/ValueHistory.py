from dataclasses import dataclass, field
import time
from typing import List

@dataclass
class ValueHistoryEvent:
    event_type: str  # e.g., "strength_increased", "drifted", "dormancy_entered", "conflict_spike"
    impact: float
    timestamp: float = field(default_factory=time.time)

class ValueHistory:
    """
    Stores only the structural evolution of a value.
    Never stores conversations or transcripts.
    """
    def __init__(self):
        self.events: List[ValueHistoryEvent] = []
        
    def add_event(self, event_type: str, impact: float = 0.0):
        self.events.append(ValueHistoryEvent(event_type=event_type, impact=impact))
