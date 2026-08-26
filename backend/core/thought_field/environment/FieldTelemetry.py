from backend.infrastructure.logging import get_logger
from .EnvironmentState import EnvironmentState

log = get_logger("core.environment")

class FieldTelemetry:
    @staticmethod
    def emit(state: EnvironmentState):
        try:
            log.info(
                "environment_ecology_updated",
                session_id=state.session_id,
                reflection=round(state.fields["reflection"].intensity, 2),
                urgency=round(state.fields["urgency"].intensity, 2),
                identity=round(state.fields["identity"].intensity, 2),
                attention=round(state.fields["attention"].intensity, 2)
            )
        except Exception:
            pass
