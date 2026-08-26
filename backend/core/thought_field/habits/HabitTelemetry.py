from backend.infrastructure.logging import get_logger
from .HabitState import HabitState
import numpy as np

log = get_logger("core.thought_ecology.habits")

class HabitTelemetry:
    @staticmethod
    def emit(session_id: str, state: HabitState):
        if not state:
            return
            
        try:
            active = len(state.active_habits)
            dormant = len(state.dormant_habits)
            extinct = len(state.extinct_habits)
            
            avg_strength = float(np.mean([h.strength for h in state.active_habits])) if active else 0.0
            avg_confidence = float(np.mean([h.confidence for h in state.active_habits])) if active else 0.0
            avg_salience = float(np.mean([h.salience for h in state.active_habits])) if active else 0.0
            avg_stability = float(np.mean([h.stability for h in state.active_habits])) if active else 0.0
            
            log.info(
                "habit_learning_tick",
                session_id=session_id,
                ActiveHabits=active,
                DormantHabits=dormant,
                ExtinctHabits=extinct,
                AverageStrength=avg_strength,
                AverageConfidence=avg_confidence,
                AverageSalience=avg_salience,
                AverageStability=avg_stability,
                TotalSalience=state.total_habit_salience
            )
        except Exception:
            pass
