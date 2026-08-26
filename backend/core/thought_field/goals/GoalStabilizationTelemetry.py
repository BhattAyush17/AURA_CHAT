from backend.infrastructure.logging import get_logger
from .GoalState import GoalState
import numpy as np

log = get_logger("core.thought_ecology.goals.stabilization")

class GoalStabilizationTelemetry:
    @staticmethod
    def emit(session_id: str, state: GoalState):
        if not state or not state.active_goals:
            return
            
        try:
            # Aggregate stats for telemetry
            avg_inertia = float(np.mean([g.inertia for g in state.active_goals]))
            avg_resilience = float(np.mean([g.resilience for g in state.active_goals]))
            avg_recovery = float(np.mean([g.recovery_capacity for g in state.active_goals]))
            
            log.info(
                "goal_stabilization_tick",
                session_id=session_id,
                AverageGoalInertia=avg_inertia,
                AverageGoalResilience=avg_resilience,
                AverageGoalRecovery=avg_recovery,
                GoalConflictLevel=state.goal_conflict_level
            )
        except Exception:
            pass
