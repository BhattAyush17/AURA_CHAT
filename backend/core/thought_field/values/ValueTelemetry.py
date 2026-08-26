from backend.infrastructure.logging import get_logger
from .ValueState import ValueState
import numpy as np

log = get_logger("core.thought_ecology.values")

class ValueTelemetry:
    @staticmethod
    def emit(session_id: str, state: ValueState):
        if not state:
            return
            
        try:
            active = len(state.active_values)
            dormant = len(state.dormant_values)
            
            avg_strength = float(np.mean([v.strength for v in state.active_values])) if active else 0.0
            avg_confidence = float(np.mean([v.confidence for v in state.active_values])) if active else 0.0
            avg_salience = float(np.mean([v.salience for v in state.active_values])) if active else 0.0
            avg_stability = float(np.mean([v.stability for v in state.active_values])) if active else 0.0
            
            log.info(
                "personal_value_model_tick",
                session_id=session_id,
                ActiveValues=active,
                DormantValues=dormant,
                AverageStrength=avg_strength,
                AverageConfidence=avg_confidence,
                AverageSalience=avg_salience,
                AverageStability=avg_stability,
                TotalConflict=state.total_value_conflict
            )
        except Exception:
            pass
