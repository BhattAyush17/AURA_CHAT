import time
from dataclasses import dataclass, field

@dataclass
class ThoughtInterpretation:
    content: str
    confidence: float
    emotional_meaning: float
    identity_meaning: float
    relationship_meaning: float
    created_at: float = field(default_factory=time.time)

    def to_dict(self):
        return {
            "content": self.content,
            "confidence": round(self.confidence, 3),
            "emotional_meaning": round(self.emotional_meaning, 3),
            "identity_meaning": round(self.identity_meaning, 3),
            "relationship_meaning": round(self.relationship_meaning, 3),
            "created_at": self.created_at
        }

    @classmethod
    def from_dict(cls, data: dict):
        return cls(
            content=data["content"],
            confidence=data.get("confidence", 0.5),
            emotional_meaning=data.get("emotional_meaning", 0.5),
            identity_meaning=data.get("identity_meaning", 0.5),
            relationship_meaning=data.get("relationship_meaning", 0.5),
            created_at=data.get("created_at", time.time())
        )
