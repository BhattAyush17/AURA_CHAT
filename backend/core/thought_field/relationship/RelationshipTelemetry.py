from backend.infrastructure.logging import get_logger
from .RelationshipState import RelationshipState

log = get_logger("core.thought_ecology.relationship")

class RelationshipTelemetry:
    @staticmethod
    def emit(session_id: str, state: RelationshipState):
        if not state:
            return
            
        try:
            log.info(
                "relationship_tick",
                session_id=session_id,
                TrustLevel=state.trust_level,
                Familiarity=state.familiarity,
                EmotionalSynchrony=state.emotional_synchrony,
                Direction=state.relationship_direction
            )
        except Exception:
            pass
