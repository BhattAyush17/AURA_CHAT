from .RelationshipState import RelationshipState

class RelationshipRecovery:
    """
    Tracks the historical capability to heal from conflicts.
    Repeated successful repairs increase recovery. Unresolved conflicts reduce it.
    """
    @staticmethod
    def evaluate(current: RelationshipState, trust_gain: float, trust_drop: float) -> float:
        # If trust was recently dropped and is now gaining back, recovery capability increases
        target_recovery = current.relationship_recovery
        
        if trust_gain > 0.01:
            # We are repairing
            target_recovery = min(0.95, target_recovery + 0.05)
        elif trust_drop > 0.05:
            # We are suffering severe conflict
            target_recovery = max(0.1, target_recovery - 0.02)
            
        new_recovery = current.relationship_recovery + (target_recovery - current.relationship_recovery) * 0.1
        
        return max(0.1, min(0.95, new_recovery))
