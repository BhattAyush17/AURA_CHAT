from backend.infrastructure.logging import get_logger
from .AwarenessHistory import AwarenessHistory

log = get_logger("core.thought_ecology.metacognition")

class AwarenessTelemetry:
    @staticmethod
    def emit(session_id: str, history: AwarenessHistory):
        if not history.is_sufficient():
            return
            
        try:
            log.info(
                "awareness_history_metrics",
                session_id=session_id,
                HistoryLength=len(history.frames),
                AverageConfidence=history.average_confidence(),
                AverageReflection=history.average_reflection(),
                ThemeStability=history.theme_persistence(),
                AttentionStability=history.attention_stability(),
                ConfidenceTrend=history.confidence_trend(),
                ReflectionTrend=history.reflection_trend(),
                AwarenessDensity=history.average_density(),
                TensionGrowth=history.tension_growth(),
                CognitiveLoadTrend=history.cognitive_load_trend()
            )
        except Exception:
            pass
