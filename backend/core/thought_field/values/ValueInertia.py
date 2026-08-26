from .Value import Value

class ValueInertia:
    """
    Computes a value's resistance to sudden change.
    
    Inertia accumulates through repeated reinforcement and time.
    A value with high inertia only shifts position when sustained evidence
    persists over many ticks — not from a single conversation.
    """
    @staticmethod
    def evaluate(value: Value, reinforcement: float, contradiction: float) -> float:
        # Inertia is anchored to stability and commitment (represented by consistency)
        base_inertia = (value.stability * 0.5) + (value.consistency * 0.3) + (value.confidence * 0.2)
        
        # Consistent reinforcement slowly solidifies inertia
        if reinforcement > 0 and contradiction == 0:
            target_inertia = min(0.95, base_inertia + 0.05)
        # Persistent contradiction mildly erodes inertia — but never rapidly
        elif contradiction > reinforcement:
            target_inertia = max(0.1, base_inertia - (0.02 * contradiction))
        else:
            target_inertia = base_inertia

        # Inertia itself moves slowly — it is a structural property
        new_inertia = value.inertia + (target_inertia - value.inertia) * 0.05
        return max(0.1, min(0.95, new_inertia))
