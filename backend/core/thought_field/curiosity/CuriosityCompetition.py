from typing import List
from .Curiosity import Curiosity

class CuriosityCompetition:
    """
    Multiple curiosities coexist; they compete only for pressure share.

    Dominance shifts naturally with uncertainty and alignment.
    No curiosity is deleted by competition — only its current pressure
    is redistributed across the landscape.

    The total "curiosity budget" is soft, not hard-capped.
    When many curiosities are active, each receives a slight pressure dampening
    proportional to the competition density — mimicking limited cognitive bandwidth.
    """
    # Maximum pressure any single curiosity can receive when many compete
    COMPETITION_DAMPENING_THRESHOLD = 5   # Start dampening after 5 active curiosities

    @staticmethod
    def apply(active_curiosities: List[Curiosity]) -> None:
        """
        Redistributes pressure in-place.
        High-pressure curiosities dominate; low-pressure ones are dampened but survive.
        """
        n = len(active_curiosities)
        if n <= CuriosityCompetition.COMPETITION_DAMPENING_THRESHOLD:
            return  # No competition effect below threshold

        # Dampening factor: the more curiosities, the more each is slightly reduced
        # At 10 active curiosities → 10% dampening per non-dominant curiosity
        excess = n - CuriosityCompetition.COMPETITION_DAMPENING_THRESHOLD
        dampening = min(0.4, excess * 0.04)  # cap at 40%

        # Rank by current pressure — highest pressure curiosity is dominant, protected
        sorted_by_pressure = sorted(active_curiosities, key=lambda c: c.pressure, reverse=True)
        dominant = sorted_by_pressure[0]

        for c in sorted_by_pressure[1:]:  # Skip dominant
            # Dampen non-dominant curiosities by competition factor, buffered by their inertia
            effective_dampening = dampening * (1.0 - c.inertia)
            c.pressure = max(0.0, c.pressure * (1.0 - effective_dampening))
