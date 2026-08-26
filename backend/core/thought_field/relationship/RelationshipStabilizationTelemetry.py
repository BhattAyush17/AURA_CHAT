from backend.infrastructure.logging import get_logger
from .RelationshipState import RelationshipState

log = get_logger("core.thought_ecology.relationship.stabilization")

class RelationshipStabilizationTelemetry:
    @staticmethod
    def emit(session_id: str, state: RelationshipState, milestones: int = 0):
        if not state:
            return
            
        try:
            log.info(
                "relationship_stabilization_tick",
                session_id=session_id,
                RelationshipConfidence=state.relationship_confidence,
                RelationshipInertia=state.relationship_inertia,
                RelationshipResilience=state.relationship_resilience,
                RelationshipRecovery=state.relationship_recovery,
                TrustStability=state.trust_level,
                MomentumStability=state.relationship_momentum,
                MilestoneCount=milestones
            )
        except Exception:
            pass
