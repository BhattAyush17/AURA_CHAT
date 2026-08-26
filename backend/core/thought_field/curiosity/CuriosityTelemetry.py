from backend.infrastructure.logging import get_logger
from .CuriosityState import CuriosityState
import numpy as np

log = get_logger("core.thought_ecology.curiosity")

class CuriosityTelemetry:
    @staticmethod
    def emit(session_id: str, state: CuriosityState):
        if not state:
            return

        try:
            active  = len(state.active_curiosities)
            dormant = len(state.dormant_curiosities)
            resolved = len(state.resolved_curiosities)

            avg_pressure     = float(np.mean([c.pressure     for c in state.active_curiosities])) if active else 0.0
            avg_novelty      = float(np.mean([c.novelty      for c in state.active_curiosities])) if active else 0.0
            avg_uncertainty  = float(np.mean([c.uncertainty  for c in state.active_curiosities])) if active else 0.0
            avg_persistence  = float(np.mean([c.persistence  for c in state.active_curiosities])) if active else 0.0

            log.info(
                "curiosity_engine_tick",
                session_id=session_id,
                ActiveCuriosities=active,
                DormantCuriosities=dormant,
                ResolvedCuriosities=resolved,
                TotalPressure=state.total_pressure,
                AveragePressure=avg_pressure,
                AverageNovelty=avg_novelty,
                AverageUncertainty=avg_uncertainty,
                AveragePersistence=avg_persistence,
                DominantTheme=state.dominant_curiosity_theme,
            )
        except Exception:
            pass
