from backend.infrastructure.logging import get_logger
from .PredictionState import PredictionState

log = get_logger("core.thought_ecology.predictive")

class PredictionTelemetry:
    @staticmethod
    def emit(session_id: str, state: PredictionState):
        if not state:
            return
            
        try:
            log.info(
                "predictive_consciousness_tick",
                session_id=session_id,
                ExpectedAttention=state.expected_attention,
                ExpectedReflection=state.expected_reflection,
                ExpectedMomentum=state.expected_emotional_momentum,
                ExpectedIdentityPressure=state.expected_identity_pressure,
                ExpectedCuriosity=state.expected_curiosity,
                ExpectedOpenLoop=state.expected_open_loop_return or "None",
                PredictionConfidence=state.prediction_confidence,
                PredictionStability=state.prediction_stability
            )
        except Exception:
            pass
