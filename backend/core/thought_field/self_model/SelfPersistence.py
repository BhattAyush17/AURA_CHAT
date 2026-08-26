import json
import os
from .SelfState import SelfState

class SelfPersistence:
    """
    Mock persistence layer for the Self Model.
    In production, this would hit Redis or Postgres.
    """
    STORAGE_DIR = "/tmp/aura_self_model"

    def __init__(self):
        os.makedirs(self.STORAGE_DIR, exist_ok=True)

    def load(self, session_id: str) -> SelfState:
        filepath = os.path.join(self.STORAGE_DIR, f"{session_id}.json")
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                return SelfState(**data)
            except Exception:
                pass
        return SelfState(session_id=session_id)

    def save(self, state: SelfState):
        filepath = os.path.join(self.STORAGE_DIR, f"{state.session_id}.json")
        with open(filepath, 'w') as f:
            json.dump(state.to_dict(), f)
