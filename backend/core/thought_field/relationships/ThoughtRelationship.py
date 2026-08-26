import time

class ThoughtRelationship:
    def __init__(self, source_id: str, target_id: str):
        self.source_id = source_id
        self.target_id = target_id
        
        # Living properties
        self.strength = 0.1
        self.stability = 0.1
        self.familiarity = 0.1
        self.resonance = 0.5
        self.tension = 0.0
        self.history = 0.0
        self.plasticity = 0.9 # High plasticity initially
        
        self.last_updated = time.time()

    def to_dict(self):
        return {
            "source_id": self.source_id,
            "target_id": self.target_id,
            "strength": round(self.strength, 3),
            "stability": round(self.stability, 3),
            "familiarity": round(self.familiarity, 3),
            "resonance": round(self.resonance, 3),
            "tension": round(self.tension, 3),
            "history": round(self.history, 3),
            "plasticity": round(self.plasticity, 3),
        }

    @classmethod
    def from_dict(cls, data: dict):
        rel = cls(data["source_id"], data["target_id"])
        rel.strength = data.get("strength", 0.1)
        rel.stability = data.get("stability", 0.1)
        rel.familiarity = data.get("familiarity", 0.1)
        rel.resonance = data.get("resonance", 0.5)
        rel.tension = data.get("tension", 0.0)
        rel.history = data.get("history", 0.0)
        rel.plasticity = data.get("plasticity", 0.9)
        return rel

    def adapt(self, n1_energy: float, n2_energy: float):
        now = time.time()
        elapsed = now - self.last_updated
        if elapsed < 0.1:
            return
            
        # 1. Experience-driven evolution (co-activation)
        co_activation = n1_energy * n2_energy
        
        if co_activation > 0.4:
            # Shared experience strengthens relationship and builds history
            self.strength = min(1.0, self.strength + (co_activation * self.plasticity * 0.1))
            self.familiarity = min(1.0, self.familiarity + 0.01)
            self.history = min(1.0, self.history + 0.01)
            
            # Plasticity drops as stability and history increase
            self.plasticity = max(0.1, 1.0 - self.stability - (self.history * 0.5))
        else:
            # Decay (Echoing history)
            decay = (1.0 - self.stability) * (elapsed / 3600.0) * self.plasticity
            self.strength = max(0.0, self.strength - decay)
            
        # If both are inactive but relationship exists, it just sleeps (history persists).
        # When both return (co_activation > 0.4), strength spikes back faster if history is high.
        if co_activation > 0.4 and self.strength < self.history:
            self.strength = min(1.0, self.strength + 0.2) # Echo recovery
            
        # Stability slowly builds if strength remains high
        if self.strength > 0.6:
            self.stability = min(1.0, self.stability + (elapsed / 36000.0))
            
        self.last_updated = now
