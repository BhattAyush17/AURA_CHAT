from backend.infrastructure.logging import get_logger
from .MonitoringState import MonitoringState

log = get_logger("core.thought_ecology.metacognition.monitor")

class MonitoringTelemetry:
    @staticmethod
    def emit(session_id: str, state: MonitoringState):
        if not state:
            return
            
        try:
            log.info(
                "cognitive_monitor_tick",
                session_id=session_id,
                LongTermConfidenceTrend=state.long_term_confidence,
                ReflectionPersistence=state.reflection_persistence,
                IdentityStability=state.identity_stability,
                AttentionDrift=state.attention_drift,
                OscillationIndex=state.oscillation_index,
                CuriosityTrend=state.curiosity_trend,
                FatigueEstimate=state.cognitive_fatigue,
                MonitoringConfidence=state.monitor_confidence
            )
        except Exception:
            pass
