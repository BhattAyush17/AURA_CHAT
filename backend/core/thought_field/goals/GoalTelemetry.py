from backend.infrastructure.logging import get_logger
from .GoalState import GoalState

log = get_logger("core.thought_ecology.goals")

class GoalTelemetry:
    @staticmethod
    def emit(session_id: str, state: GoalState):
        if not state:
            return
            
        try:
            log.info(
                "goal_memory_tick",
                session_id=session_id,
                ActiveGoals=len(state.active_goals),
                DormantGoals=len(state.dormant_goals),
                FulfilledGoals=len(state.fulfilled_goals),
                AbandonedGoals=len(state.abandoned_goals),
                GoalConflictLevel=state.goal_conflict_level,
                TotalMomentum=state.total_active_momentum
            )
        except Exception:
            pass
