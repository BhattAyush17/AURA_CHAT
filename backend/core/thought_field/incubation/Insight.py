import time
from typing import List

class Insight:
    def __init__(self, insight_id: str, origin_seeds: List[str], supporting_thoughts: List[str], theme: str):
        self.id = insight_id
        self.origin_seeds = origin_seeds
        self.supporting_thoughts = supporting_thoughts
        self.theme = theme # The core realization
        
        self.confidence = 0.5
        self.maturity = 1.0
        self.novelty = 0.8
        self.stability = 0.5
        self.integration_level = 0.1
        
        # Internal ecological impacts
        self.identity_impact = 0.0
        self.emotional_impact = 0.0
        self.relationship_impact = 0.0
        
        self.created_at = time.time()
        self.applied = False # Track if it has modified the ecology yet

    def to_dict(self):
        return {
            "id": self.id,
            "origin_seeds": self.origin_seeds,
            "supporting_thoughts": self.supporting_thoughts,
            "theme": self.theme,
            "confidence": round(self.confidence, 3),
            "maturity": round(self.maturity, 3),
            "novelty": round(self.novelty, 3),
            "stability": round(self.stability, 3),
            "integration_level": round(self.integration_level, 3),
            "identity_impact": round(self.identity_impact, 3),
            "emotional_impact": round(self.emotional_impact, 3),
            "relationship_impact": round(self.relationship_impact, 3),
            "created_at": self.created_at,
            "applied": self.applied
        }
        
    @classmethod
    def from_dict(cls, data: dict):
        insight = cls(
            data["id"], 
            data.get("origin_seeds", []), 
            data.get("supporting_thoughts", []), 
            data.get("theme", "")
        )
        insight.confidence = data.get("confidence", 0.5)
        insight.maturity = data.get("maturity", 1.0)
        insight.novelty = data.get("novelty", 0.8)
        insight.stability = data.get("stability", 0.5)
        insight.integration_level = data.get("integration_level", 0.1)
        insight.identity_impact = data.get("identity_impact", 0.0)
        insight.emotional_impact = data.get("emotional_impact", 0.0)
        insight.relationship_impact = data.get("relationship_impact", 0.0)
        insight.created_at = data.get("created_at", time.time())
        insight.applied = data.get("applied", False)
        return insight
