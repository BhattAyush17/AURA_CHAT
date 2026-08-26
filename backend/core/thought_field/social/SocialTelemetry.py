from backend.infrastructure.logging import get_logger
from .SocialState import SocialState

log = get_logger("core.thought_ecology.social")

class SocialTelemetry:
    @staticmethod
    def emit(session_id: str, state: SocialState):
        if not state:
            return
            
        try:
            log.info(
                "social_perception_tick",
                session_id=session_id,
                Engagement=state.engagement_estimate,
                Openness=state.openness_estimate,
                Hesitation=state.hesitation_estimate,
                EmotionalBandwidth=state.emotional_bandwidth_estimate,
                CognitiveBandwidth=state.cognitive_bandwidth_estimate,
                Energy=state.conversation_energy_estimate,
                SocialLoad=state.estimated_social_load,
                PerceptionConfidence=state.perception_confidence
            )
        except Exception:
            pass
