from dataclasses import dataclass, field
import time
from typing import List

@dataclass
class CuriosityHistoryEvent:
    event_type: str   # "pressure_rose", "resolved", "dormancy_entered", "revived"
    impact: float
    timestamp: float = field(default_factory=time.time)


@dataclass
class Curiosity:
    """
    One active unresolved cognitive attraction.

    ARCHITECTURAL INVARIANT: CURIOSITY IS TENSION TOWARD RESOLUTION.
    - No transcripts, prompts, or LLM outputs are stored.
    - This object tracks the structural mathematics of cognitive pull.
    - It does NOT perform exploration; it only measures the pressure toward it.
    """
    id: str
    theme: str
    source: str                       # CuriositySource constant

    # Core signals (all 0–1)
    pressure: float = 0.1             # How strongly cognition is pulled
    strength: float = 0.1             # Long-term importance of this attraction
    confidence: float = 0.1          # Certainty that the curiosity is genuine
    novelty: float = 0.5             # Unfamiliarity of the unresolved space
    uncertainty: float = 0.5         # Degree of genuine unknowns
    resolution: float = 0.0          # How much of the gap has been closed (0=open, 1=resolved)
    persistence: float = 0.5         # Resistance to decay

    # Stabilization attributes (Phase 5.10A)
    inertia: float = 0.5             # Resistance to sudden pressure change
    resilience: float = 0.1          # Tolerance of temporary certainty without dying
    recovery_capacity: float = 0.5   # Historical speed of revival from dormancy
    convergence_id: str = ""         # If non-empty, has merged toward another curiosity theme

    # Lifecycle
    lifecycle_state: str = "SPARKING"
    # SPARKING -> FORMING -> ACTIVE -> PERSISTENT -> SATISFYING -> RESOLVED -> DORMANT -> EXTINCT

    # Tracking
    created_time: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)
    last_activated: float = field(default_factory=time.time)
    history: List[CuriosityHistoryEvent] = field(default_factory=list)

    def add_history(self, event_type: str, impact: float = 0.0):
        self.history.append(CuriosityHistoryEvent(event_type=event_type, impact=impact))
