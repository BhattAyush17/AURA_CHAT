from dataclasses import dataclass

@dataclass(frozen=True)
class BehaviorEnvelope:
    """
    The final output of the Associative Thought Field.
    Permanently separates internal cognition (what AURA thinks) from
    external realization (how AURA chooses to express it).
    """
    cognitive_snapshot: str
    behavior_expression: str
