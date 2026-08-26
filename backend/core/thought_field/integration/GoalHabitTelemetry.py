import logging
from .GoalHabitAlignment import GoalHabitAlignment

logger = logging.getLogger("AURA.GoalHabitIntegration")

class GoalHabitTelemetry:
    @staticmethod
    def emit(session_id: str, alignment: GoalHabitAlignment):
        logger.debug(f"[GoalHabitIntegration] Session {session_id} - "
                     f"Align: {alignment.total_alignment:.2f}, "
                     f"Misalign: {alignment.total_misalignment:.2f}, "
                     f"Supporting Habits: {alignment.supporting_habits}, "
                     f"Unsupported Goals: {alignment.unsupported_goals}, "
                     f"Trend (Align/Misalign): {alignment.alignment_trend:.2f} / {alignment.misalignment_trend:.2f}")
