from typing import Dict, List
from .Curiosity import Curiosity

class CuriosityConvergence:
    """
    Independent curiosities may gradually converge when thematically adjacent.

    Example: "Scaling" + "Latency" + "Memory" → "Distributed Architecture"

    Convergence rules:
    - Convergence is detected by theme substring overlap (structural, not semantic).
    - Only weak curiosities (low pressure) merge toward stronger ones.
    - The source curiosity's pressure transfers partially to the target.
    - The source is marked with convergence_id and enters DORMANT gracefully.
    - History is preserved on both sides.

    Convergence never destroys curiosity — it transforms it.
    """
    SIMILARITY_BOOST = 0.08  # Pressure added to target per convergence event
    CONVERGENCE_THRESHOLD = 0.15  # Source must have pressure below this to converge

    @staticmethod
    def apply(curiosities: Dict[str, Curiosity]) -> None:
        """
        Detects and applies convergence in-place.
        Called once per experience() tick.
        """
        active = [c for c in curiosities.values()
                  if c.lifecycle_state in ("FORMING", "ACTIVE", "PERSISTENT", "SATISFYING")
                  and not c.convergence_id]

        for source in active:
            if source.pressure > CuriosityConvergence.CONVERGENCE_THRESHOLD:
                continue  # Only weak curiosities converge

            # Find a stronger thematically adjacent target
            target = CuriosityConvergence._find_target(source, active)
            if target is None:
                continue

            # Transfer partial pressure
            transfer = source.pressure * 0.3
            target.pressure = min(1.0, target.pressure + CuriosityConvergence.SIMILARITY_BOOST)
            target.persistence = min(0.95, target.persistence + 0.02)

            # Mark source as converged
            source.convergence_id = target.id
            source.pressure *= 0.5
            source.add_history("converged_into", transfer)
            target.add_history("received_convergence", transfer)

    @staticmethod
    def _find_target(source: Curiosity, candidates: List[Curiosity]) -> "Curiosity | None":
        """
        Finds the strongest candidate that shares thematic overlap with source.
        Structural comparison only — no NLP or semantic embeddings.
        """
        source_words = set(source.theme.lower().split())
        best: "Curiosity | None" = None
        best_pressure = 0.0

        for c in candidates:
            if c.id == source.id:
                continue
            target_words = set(c.theme.lower().split())
            overlap = source_words & target_words
            if overlap and c.pressure > best_pressure and c.pressure > source.pressure:
                best = c
                best_pressure = c.pressure

        return best
