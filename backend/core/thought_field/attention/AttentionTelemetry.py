from backend.infrastructure.logging import get_logger
from .AwarenessWindow import AwarenessWindow

log = get_logger("core.thought_ecology.attention")

class AttentionTelemetry:
    @staticmethod
    def emit(session_id: str, window: AwarenessWindow):
        try:
            log.info(
                "attention_gate_tick",
                session_id=session_id,
                AwarenessCapacity=window.capacity,
                ConsciousThoughts=len(window.conscious_thoughts),
                SuppressedThoughts=window.suppressed_count,
                AttentionDirection=window.attention_direction,
                HasInsight=bool(window.emerging_insight)
            )
        except Exception:
            pass
