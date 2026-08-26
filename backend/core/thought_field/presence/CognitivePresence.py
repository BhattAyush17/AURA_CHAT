import time
from typing import Dict
from ..ecology.ThoughtAffinity import ThoughtAffinity

class CognitivePresence:
    def __init__(self):
        self.pressures: Dict[str, float] = {
            "identity": 0.0,
            "reflection": 0.0,
            "novelty": 0.0,
            "relationship": 0.0,
            "curiosity": 0.0,
            "comfort": 0.0,
            "urgency": 0.0,
            "attention": 0.0
        }
        self.last_updated = time.time()

    def deposit(self, affinity: ThoughtAffinity, amount: float):
        # When a thought leaves awareness, it deposits residue
        for k in self.pressures.keys():
            val = getattr(affinity, k, 0.0)
            self.pressures[k] = min(1.0, self.pressures[k] + (val * amount))

    def tick(self):
        now = time.time()
        elapsed = now - self.last_updated
        if elapsed < 0.1:
            return
        self.last_updated = now
        
        # Natural decay of presence (silent drift)
        decay = elapsed / 36000.0 # Slow decay
        
        # Resonance (e.g., reflection strengthens identity, urgency suppresses reflection)
        if self.pressures["reflection"] > 0.5:
            self.pressures["identity"] = min(1.0, self.pressures["identity"] + (decay * 0.5))
        if self.pressures["urgency"] > 0.5:
            self.pressures["reflection"] = max(0.0, self.pressures["reflection"] - (decay * 2.0))
            
        for k in self.pressures.keys():
            self.pressures[k] = max(0.0, self.pressures[k] - decay)

    def get_resonance(self, affinity: ThoughtAffinity) -> float:
        res = 0.0
        for k, v in self.pressures.items():
            res += (v * getattr(affinity, k, 0.0))
        return res

    def to_dict(self):
        return {k: round(v, 3) for k, v in self.pressures.items()}
        
    def load_dict(self, data: dict):
        for k in self.pressures.keys():
            self.pressures[k] = data.get(k, 0.0)

    def get_bias_string(self) -> str:
        dominant = max(self.pressures.items(), key=lambda x: x[1])
        if dominant[1] > 0.3:
            return f"Leaning towards {dominant[0]}"
        return ""
