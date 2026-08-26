from .RelationshipState import RelationshipState

class RelationshipResilience:
    """
    Evaluates how quickly a relationship can bounce back from conflict.
    Tied to historical trust and recovery capacity.
    """
    @staticmethod
    def evaluate(current: RelationshipState, trust_drop: float) -> float:
        # High historical trust and strong recovery capability breed resilience
        base_resilience = (current.trust_level * 0.6) + (current.relationship_recovery * 0.4)
        
        # If there is a massive sudden drop in trust, resilience takes a temporary hit
        if trust_drop > 0.1:
            target_resilience = max(0.1, base_resilience - (trust_drop * 0.5))
        else:
            target_resilience = min(0.95, base_resilience + 0.01)
            
        new_resilience = current.relationship_resilience + (target_resilience - current.relationship_resilience) * 0.05
        
        return max(0.1, min(0.95, new_resilience))
