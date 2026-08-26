from backend.infrastructure.logging import get_logger
from .SocialModelState import SocialModelState

log = get_logger("core.thought_ecology.social_model")

class SocialModelTelemetry:
    @staticmethod
    def emit(session_id: str, state: SocialModelState):
        if not state:
            return
            
        try:
            log.info(
                "social_model_tick",
                session_id=session_id,
                ModelConfidence=state.model_confidence,
                RelationshipComfort=state.relationship_comfort,
                HumorPreference=state.humor_preference,
                EnergyPreference=state.conversation_energy_preference,
                FormalityPreference=state.formality_preference,
                ConversationPredictability=state.conversation_predictability
            )
        except Exception:
            pass
