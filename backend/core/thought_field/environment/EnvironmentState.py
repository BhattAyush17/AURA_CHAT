from dataclasses import dataclass, field
import time
from typing import Dict
from .Field import Field

@dataclass
class EnvironmentState:
    session_id: str
    fields: Dict[str, Field] = field(default_factory=dict)
    last_updated: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "fields": {k: {"intensity": round(v.intensity, 3)} for k, v in self.fields.items()},
            "last_updated": self.last_updated
        }
