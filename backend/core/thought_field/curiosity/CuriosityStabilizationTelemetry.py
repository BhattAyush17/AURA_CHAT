from backend.infrastructure.logging import get_logger
from .CuriosityState import CuriosityState
import numpy as np

log = get_logger("core.thought_ecology.curiosity.stabilization")

class CuriosityStabilizationTelemetry:
    @staticmethod
    def emit(session_id: str, state: CuriosityState):
        if not state or not state.active_curiosities:
            return

        try:
            active   = state.active_curiosities
            dormant  = len(state.dormant_curiosities)
            resolved = len(state.resolved_curiosities)

            avg_inertia   = float(np.mean([c.inertia           for c in active]))
            avg_resilience= float(np.mean([c.resilience         for c in active]))
            avg_recovery  = float(np.mean([c.recovery_capacity  for c in active]))
            avg_pressure  = float(np.mean([c.pressure           for c in active]))
            converged     = sum(1 for c in active if c.convergence_id)

            log.info(
                "curiosity_stabilization_tick",
                session_id=session_id,
                AvgCuriosityInertia=avg_inertia,
                AvgCuriosityResilience=avg_resilience,
                AvgCuriosityRecovery=avg_recovery,
                AvgCuriosityPressure=avg_pressure,
                DormantCuriosities=dormant,
                ResolvedCuriosities=resolved,
                ConvergedCuriosities=converged,
            )
        except Exception:
            pass
