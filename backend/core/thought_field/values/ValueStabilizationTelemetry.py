from backend.infrastructure.logging import get_logger
from .ValueState import ValueState
import numpy as np

log = get_logger("core.thought_ecology.values.stabilization")

class ValueStabilizationTelemetry:
    @staticmethod
    def emit(session_id: str, state: ValueState):
        if not state or not state.active_values:
            return

        try:
            avg_inertia      = float(np.mean([v.inertia           for v in state.active_values]))
            avg_resilience   = float(np.mean([v.resilience         for v in state.active_values]))
            avg_recovery     = float(np.mean([v.recovery_capacity  for v in state.active_values]))
            avg_stability    = float(np.mean([v.stability          for v in state.active_values]))
            avg_drift        = float(np.mean([v.drift              for v in state.active_values]))
            max_hierarchy    = max((v.hierarchy_depth               for v in state.active_values), default=0)

            log.info(
                "value_stabilization_tick",
                session_id=session_id,
                AvgValueInertia=avg_inertia,
                AvgValueResilience=avg_resilience,
                AvgValueRecovery=avg_recovery,
                AvgValueStability=avg_stability,
                AvgValueDrift=avg_drift,
                MaxHierarchyDepth=max_hierarchy,
                TotalConflict=state.total_value_conflict,
            )
        except Exception:
            pass
