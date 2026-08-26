from dataclasses import dataclass, field
from typing import List
from .Curiosity import Curiosity

@dataclass(frozen=True)
class CuriosityState:
    """
    Immutable snapshot of the curiosity landscape at a given tick.
    Consumed READ ONLY by Identity Evolution and future subsystems.
    """
    active_curiosities: List[Curiosity]
    dormant_curiosities: List[Curiosity]
    resolved_curiosities: List[Curiosity]
    extinct_curiosities: List[Curiosity]

    dominant_curiosity_theme: str = ""
    total_pressure: float = 0.0
    average_novelty: float = 0.0
    average_uncertainty: float = 0.0
