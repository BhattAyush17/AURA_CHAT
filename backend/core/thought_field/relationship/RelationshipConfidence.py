from .RelationshipState import RelationshipState
from ..social.SocialModelState import SocialModelState

class RelationshipConfidence:
    """
    Evaluates relationship confidence independently of trust.
    Confidence determines resistance to sudden change.
    """
    @staticmethod
    def evaluate(current: RelationshipState, social_model: SocialModelState, history_size: int, elapsed_time: float) -> float:
        # Confidence increases slowly with interaction history
        history_factor = min(1.0, history_size / 150.0)
        
        # Consistent interaction increases confidence, contradiction (oscillation) lowers it
        predictability = social_model.conversation_predictability
        
        # Drift penalty: long periods of inactivity slowly decay confidence
        drift_penalty = 0.0
        if elapsed_time > 86400 * 7: # 1 week
            drift_penalty = min(0.3, (elapsed_time / (86400 * 7)) * 0.05)
            
        base_confidence = current.relationship_confidence
        
        # Smooth interpolation toward the target confidence
        target_confidence = (history_factor * 0.4) + (predictability * 0.6)
        
        # Decay from drift
        target_confidence = max(0.1, target_confidence - drift_penalty)
        
        # Move base confidence toward target very slowly
        new_confidence = base_confidence + (target_confidence - base_confidence) * 0.05
        
        # Ensure asymptotic bounds (0.1 to 0.95)
        return max(0.1, min(0.95, new_confidence))
