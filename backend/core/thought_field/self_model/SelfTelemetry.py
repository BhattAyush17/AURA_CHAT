from backend.infrastructure.logging import get_logger
from .SelfState import SelfState

log = get_logger("core.self_model")

class SelfTelemetry:
    @staticmethod
    def emit(state: SelfState):
        log.info(
            "self_model_updated",
            session_id=state.session_id,
            energy=round(state.mental_energy, 2),
            load=round(state.cognitive_load, 2),
            confidence=round(state.confidence, 2),
            reflection=round(state.reflection_depth, 2)
        )
