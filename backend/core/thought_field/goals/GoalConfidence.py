from .Goal import Goal
import time

class GoalConfidence:
    @staticmethod
    def evaluate(goal: Goal, reinforcement_strength: float, contradiction_strength: float) -> float:
        """
        Confidence measures how certain AURA is that this goal genuinely matters.
        Evolves independently of progress.
        """
        target_confidence = goal.confidence
        
        # Reinforcement slowly builds confidence
        if reinforcement_strength > 0:
            target_confidence = min(0.95, target_confidence + (reinforcement_strength * 0.05))
            
        # Contradiction rapidly drops confidence
        if contradiction_strength > 0:
            target_confidence = max(0.05, target_confidence - (contradiction_strength * 0.15))
            
        # Slow drift if neither
        if reinforcement_strength == 0 and contradiction_strength == 0:
            elapsed = time.time() - goal.last_updated
            if elapsed > 86400 * 3: # 3 days
                target_confidence = max(0.05, target_confidence - 0.01)
                
        # Smooth interpolation
        new_confidence = goal.confidence + (target_confidence - goal.confidence) * 0.1
        
        # Log history if massive shift
        if abs(new_confidence - goal.confidence) > 0.1:
            goal.add_history("confidence_changed", new_confidence - goal.confidence)
            
        return max(0.05, min(0.95, new_confidence))
