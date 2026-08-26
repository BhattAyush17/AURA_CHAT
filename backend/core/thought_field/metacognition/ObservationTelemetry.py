from backend.infrastructure.logging import get_logger
from .MetacognitiveObservation import MetacognitiveObservation

log = get_logger("core.thought_ecology.metacognition")

class ObservationTelemetry:
    @staticmethod
    def emit(session_id: str, observation: MetacognitiveObservation):
        if not observation:
            return
            
        try:
            log.info(
                "metacognitive_observation",
                session_id=session_id,
                ObservationType=observation.observation_type,
                Confidence=observation.confidence,
                Intensity=observation.intensity,
                EmotionalContext=observation.emotional_context
            )
        except Exception:
            pass
