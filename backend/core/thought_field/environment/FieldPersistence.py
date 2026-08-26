import json
import os
from .EnvironmentState import EnvironmentState
from .Field import Field

class FieldPersistence:
    STORAGE_DIR = "/tmp/aura_environment"

    def __init__(self):
        os.makedirs(self.STORAGE_DIR, exist_ok=True)

    def load(self, session_id: str) -> EnvironmentState:
        filepath = os.path.join(self.STORAGE_DIR, f"{session_id}.json")
        default_fields = {
            "emotional": Field("emotional", 0.5, 0.2, 0.05),
            "reflection": Field("reflection", 0.5, 0.8, 0.01),
            "curiosity_field": Field("curiosity_field", 0.5, 0.4, 0.05),
            "comfort": Field("comfort", 0.5, 0.5, 0.02),
            "identity": Field("identity", 0.8, 0.9, 0.001),
            "goal": Field("goal", 0.5, 0.6, 0.02),
            "novelty": Field("novelty", 0.5, 0.1, 0.1),
            "attention": Field("attention", 0.5, 0.3, 0.05),
            "urgency": Field("urgency", 0.0, 0.1, 0.2, target_baseline=0.0),
            "uncertainty": Field("uncertainty", 0.0, 0.3, 0.05, target_baseline=0.0),
            "relationship": Field("relationship", 0.5, 0.9, 0.01),
            "atmosphere": Field("atmosphere", 0.5, 0.5, 0.05),
        }
        
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                
                # Restore field objects
                fields = {}
                for k, v in data.get("fields", {}).items():
                    if k in default_fields:
                        f_obj = default_fields[k]
                        f_obj.intensity = v.get("intensity", 0.5)
                        fields[k] = f_obj
                
                # Fill any missing with defaults
                for k, f_obj in default_fields.items():
                    if k not in fields:
                        fields[k] = f_obj
                        
                return EnvironmentState(session_id=session_id, fields=fields, last_updated=data.get("last_updated", 0))
            except Exception:
                pass
        
        return EnvironmentState(session_id=session_id, fields=default_fields)

    def save(self, state: EnvironmentState):
        filepath = os.path.join(self.STORAGE_DIR, f"{state.session_id}.json")
        with open(filepath, 'w') as f:
            json.dump(state.to_dict(), f)
