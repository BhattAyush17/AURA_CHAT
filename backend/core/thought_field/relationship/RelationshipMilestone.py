from dataclasses import dataclass, field
import time

@dataclass(frozen=True)
class RelationshipMilestone:
    """
    Represents structural turning points in the relationship.
    Never stores transcripts, prompts, or conversation text.
    """
    milestone_type: str # e.g. "first_sustained_trust", "major_disagreement", "long_silence"
    relationship_impact: float # -1.0 to 1.0 (negative to positive impact)
    confidence: float
    timestamp: float = field(default_factory=time.time)
