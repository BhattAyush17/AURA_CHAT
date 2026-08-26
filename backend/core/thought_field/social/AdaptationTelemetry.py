from backend.infrastructure.logging import get_logger
from .ExpressionStyle import ExpressionStyle

log = get_logger("core.thought_ecology.social_adaptation")

class AdaptationTelemetry:
    @staticmethod
    def emit(session_id: str, style: ExpressionStyle, drift: float):
        if not style:
            return
            
        try:
            log.info(
                "social_adaptation_tick",
                session_id=session_id,
                PersonalityMode=style.mode_profile,
                AdaptationConfidence=style.adaptation_confidence,
                ExpressionDrift=drift,
                Warmth=style.warmth,
                Humor=style.humor,
                Directness=style.directness,
                Energy=style.conversational_energy,
                Verbosity=style.verbosity,
                TechnicalDepth=style.technical_depth,
                ChallengeLevel=style.challenge_level
            )
        except Exception:
            pass
