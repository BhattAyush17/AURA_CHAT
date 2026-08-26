from backend.infrastructure.logging import get_logger
from .FeedbackState import FeedbackState

log = get_logger("core.thought_ecology.metacognition.feedback")

class FeedbackTelemetry:
    @staticmethod
    def emit(session_id: str, state: FeedbackState):
        if not state or not state.regulated_parameters:
            return
            
        try:
            log.info(
                "introspective_feedback_tick",
                session_id=session_id,
                FeedbackStrength=state.feedback_strength,
                FeedbackDirection=state.feedback_direction,
                FeedbackConfidence=state.confidence,
                HomeostasisStability=state.stability,
                RegulationEvents=len(state.regulated_parameters),
                **{f"Adj_{k}": v for k, v in state.regulated_parameters.items()}
            )
        except Exception:
            pass
