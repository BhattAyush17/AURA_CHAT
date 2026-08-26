from .Goal import Goal
from .GoalConfidence import GoalConfidence
from .GoalMomentum import GoalMomentum
from .GoalDormancy import GoalDormancy
from .GoalInertia import GoalInertia
from .GoalResilience import GoalResilience
from .GoalRecovery import GoalRecovery
from ..relationship.RelationshipState import RelationshipState
from ..self_model.SelfState import SelfState
import time

class GoalStabilizer:
    @staticmethod
    def stabilize_goal(goal: Goal, 
                       reinforcement_strength: float, 
                       contradiction_strength: float, 
                       activity_strength: float,
                       progress_delta: float,
                       relationship_state: RelationshipState,
                       self_state: SelfState) -> Goal:
        """
        Evolves a single goal's parameters based on recent evidence and elapsed time.
        """
        now = time.time()
        
        # 1. Update Confidence
        goal.confidence = GoalConfidence.evaluate(goal, reinforcement_strength, contradiction_strength)
        
        # 2. Update Momentum with Resilience & Recovery logic
        target_momentum = GoalMomentum.evaluate(goal, activity_strength)
        momentum_drop = max(0.0, goal.momentum - target_momentum)
        momentum_gain = max(0.0, target_momentum - goal.momentum)
        
        goal.recovery_capacity = GoalRecovery.evaluate(goal, momentum_gain, momentum_drop)
        goal.resilience = GoalResilience.evaluate(goal, momentum_drop)
        
        # Apply resilience if dropping, inertia if gaining
        if target_momentum < goal.momentum:
            effective_lr = 0.1 * (1.0 - goal.resilience)
        else:
            # target > current
            effective_lr = 0.1 * (1.0 - goal.inertia)
            
        new_momentum = goal.momentum + (target_momentum - goal.momentum) * effective_lr
        
        # Inertia calculation
        goal.inertia = GoalInertia.evaluate(goal, new_momentum)
        goal.momentum = new_momentum
        
        # 3. Update Progress
        if progress_delta != 0:
            goal.progress = max(0.0, min(1.0, goal.progress + progress_delta))
            
        # 4. Update Commitment (Grows with progress and voluntary effort/activity)
        if activity_strength > 0 and progress_delta >= 0:
            goal.commitment = min(1.0, goal.commitment + (activity_strength * 0.05))
        elif contradiction_strength > 0:
            goal.commitment = max(0.0, goal.commitment - (contradiction_strength * 0.1))
            
        # 5. Relationship Alignment (Read-Only)
        # Trust makes vulnerable/difficult goals more aligned
        goal.relationship_alignment = relationship_state.trust_level
        
        # 6. Lifecycle / Dormancy
        new_state = GoalDormancy.evaluate(goal)
        if new_state != goal.lifecycle_state:
            goal.lifecycle_state = new_state
            
        # 7. Importance (Grows extremely slowly with sustained commitment and confidence)
        if goal.commitment > 0.8 and goal.confidence > 0.8:
            goal.importance = min(1.0, goal.importance + 0.01)
            
        goal.last_updated = now
        return goal
