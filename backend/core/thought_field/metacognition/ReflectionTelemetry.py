from backend.infrastructure.logging import get_logger
from .ReflectionState import ReflectionState

log = get_logger("core.thought_ecology.metacognition")

class ReflectionTelemetry:
    @staticmethod
    def emit(session_id: str, state: ReflectionState):
        if not state:
            return
            
        try:
            log.info(
                "reflection_state_tick",
                session_id=session_id,
                CertaintyDirection=state.certainty_direction,
                AttentionPattern=state.attention_pattern,
                EmotionalDirection=state.emotional_direction,
                IdentityPressure=state.identity_pressure,
                InternalStability=state.internal_stability,
                DominantTransition=state.dominant_transition.name,
                LifecycleStage=state.lifecycle_stage,
                Confidence=state.confidence,
                Coherence=state.coherence,
                RecurrenceStrength=state.recurrence_strength
            )
        except Exception:
            pass
