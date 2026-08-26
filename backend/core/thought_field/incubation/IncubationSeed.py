import time
from enum import Enum
from typing import List, Dict

class IncubationState(Enum):
    DORMANT = 0
    INCUBATING = 1
    MATURING = 2
    INSIGHT = 3
    RESOLVED = 4
    DISSOLVED = 5

class IncubationSeed:
    def __init__(self, seed_id: str, origin_node_ids: List[str], theme: str, origin_type: str = "Unknown"):
        self.id = seed_id
        self.origin_node_ids = origin_node_ids
        self.theme = theme # Abstract theme representation
        self.origin_type = origin_type # Contradiction, Curiosity, Reconsolidation, etc.
        
        self.state = IncubationState.DORMANT
        self.pressure = 0.1
        self.coherence = 0.1
        self.maturity = 0.0
        
        self.last_updated = time.time()
        self.created_at = time.time()

    def adapt(self, env_fields: dict, self_state, presence, graph):
        now = time.time()
        elapsed = now - self.last_updated
        if elapsed < 0.1:
            return
            
        self.last_updated = now
        
        if self.state in (IncubationState.RESOLVED, IncubationState.DISSOLVED, IncubationState.INSIGHT):
            return
            
        # 1. Calculate Ecological Pressure
        # Pressure fluctuates based on unresolved tension in environment and presence
        env_tension = env_fields.get("urgency").intensity if env_fields.get("urgency") else 0.5
        presence_tension = presence.pressures.get("attention", 0.0) + presence.pressures.get("reflection", 0.0)
        
        # Check if origin thoughts are still relevant/active
        origin_active = sum(1 for node_id in self.origin_node_ids if graph.get_node(node_id) and graph.get_node(node_id).energy > 0.4)
        
        target_pressure = (env_tension + presence_tension + (origin_active * 0.2)) / 3.0
        
        # Fluctuation (Pressure is not monotonic)
        self.pressure = self.pressure + (target_pressure - self.pressure) * (elapsed / 3600.0)
        
        # 2. Coherence and Maturity
        # High cognitive load regresses incubation
        if self_state.cognitive_load > 0.8:
            self.coherence -= (elapsed / 3600.0) * 0.3
            self.maturity -= (elapsed / 7200.0) * 0.1
        # Coherence builds if reflection is high, attention bandwidth is available, and pressure is stable
        elif self_state.reflection_depth > 0.6 and self.pressure > 0.4 and self_state.attention_bandwidth > 0.5:
            self.coherence += (elapsed / 3600.0) * 0.5
            self.maturity += (elapsed / 7200.0)
        else:
            # Coherence diffuses if ignored or stalled
            self.coherence -= (elapsed / 7200.0) * 0.2
            
        self.coherence = max(0.0, min(1.0, self.coherence))
        self.maturity = max(0.0, min(1.0, self.maturity))
        
        # 3. Natural Dissolution
        # If support vanishes for a long time, it dissolves
        if self.maturity < 0.1 and self.coherence == 0.0 and self.pressure < 0.1:
            self.state = IncubationState.DISSOLVED
            return
            
        # 4. State Transitions
        if self.coherence > 0.8 and self.maturity > 0.7:
            self.state = IncubationState.INSIGHT
        elif self.coherence > 0.5:
            self.state = IncubationState.MATURING
        elif self.pressure > 0.3:
            self.state = IncubationState.INCUBATING
        else:
            self.state = IncubationState.DORMANT

    def to_dict(self):
        return {
            "id": self.id,
            "origin_node_ids": self.origin_node_ids,
            "theme": self.theme,
            "origin_type": self.origin_type,
            "state": self.state.name,
            "pressure": round(self.pressure, 3),
            "coherence": round(self.coherence, 3),
            "maturity": round(self.maturity, 3),
            "created_at": self.created_at
        }
        
    @classmethod
    def from_dict(cls, data: dict):
        seed = cls(data["id"], data.get("origin_node_ids", []), data.get("theme", ""), data.get("origin_type", "Unknown"))
        seed.state = IncubationState[data.get("state", "DORMANT")]
        seed.pressure = data.get("pressure", 0.1)
        seed.coherence = data.get("coherence", 0.1)
        seed.maturity = data.get("maturity", 0.0)
        seed.created_at = data.get("created_at", time.time())
        return seed
