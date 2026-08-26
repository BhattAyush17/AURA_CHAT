from .RelationshipState import RelationshipState

class RelationshipInertia:
    """
    Evaluates relationship directional inertia.
    High inertia prevents single interactions from changing long-term trajectories.
    """
    @staticmethod
    def evaluate(current: RelationshipState, new_momentum: float) -> float:
        # Inertia is tightly coupled to relationship confidence and familiarity
        base_inertia = (current.relationship_confidence * 0.7) + (current.familiarity * 0.3)
        
        # If the new momentum matches the current trajectory (e.g. deepening -> deepening),
        # inertia slightly increases (solidifying the trajectory)
        current_momentum = current.relationship_momentum
        
        # If moving in same direction relative to 0.5 center point
        if (current_momentum > 0.5 and new_momentum > 0.5) or (current_momentum < 0.5 and new_momentum < 0.5):
            target_inertia = min(0.95, base_inertia + 0.05)
        else:
            # If changing direction, inertia resists the change but slowly weakens
            target_inertia = max(0.1, base_inertia - 0.05)
            
        # Smooth update
        new_inertia = current.relationship_inertia + (target_inertia - current.relationship_inertia) * 0.1
        
        return max(0.1, min(0.95, new_inertia))
