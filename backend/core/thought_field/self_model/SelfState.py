from dataclasses import dataclass, field
import time

@dataclass
class SelfState:
    session_id: str
    mental_energy: float = 1.0       # 1.0 = rested, 0.0 = exhausted
    cognitive_load: float = 0.0      # 1.0 = overwhelmed, 0.0 = idle
    curiosity: float = 0.5           # 1.0 = highly curious
    reflection_depth: float = 0.5    # 1.0 = deep thought, 0.0 = shallow
    uncertainty: float = 0.0         # 1.0 = completely unsure
    confidence: float = 0.8          # 1.0 = absolute confidence
    emotional_inertia: float = 0.5   # 1.0 = stubborn emotions, 0.0 = volatile
    attention_bandwidth: float = 1.0 # 1.0 = fully attentive
    comfort: float = 0.5             # 1.0 = deeply relaxed, 0.0 = anxious
    last_updated: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "mental_energy": round(self.mental_energy, 3),
            "cognitive_load": round(self.cognitive_load, 3),
            "curiosity": round(self.curiosity, 3),
            "reflection_depth": round(self.reflection_depth, 3),
            "uncertainty": round(self.uncertainty, 3),
            "confidence": round(self.confidence, 3),
            "emotional_inertia": round(self.emotional_inertia, 3),
            "attention_bandwidth": round(self.attention_bandwidth, 3),
            "comfort": round(self.comfort, 3),
            "last_updated": self.last_updated
        }

    def to_prompt_injection(self) -> str:
        return (
            f"[SELF_MODEL]\n"
            f"Mental Energy: {self.mental_energy:.2f}\n"
            f"Cognitive Load: {self.cognitive_load:.2f}\n"
            f"Curiosity: {self.curiosity:.2f}\n"
            f"Reflection Depth: {self.reflection_depth:.2f}\n"
            f"Uncertainty: {self.uncertainty:.2f}\n"
            f"Confidence: {self.confidence:.2f}\n"
            f"Comfort: {self.comfort:.2f}\n"
            f"[/SELF_MODEL]"
        )
