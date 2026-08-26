import time
from .SelfState import SelfState
from .SelfDynamics import SelfDynamics
from .SelfPersistence import SelfPersistence
from .SelfTelemetry import SelfTelemetry

class SelfModel:
    _instances = {}
    _persistence = SelfPersistence()

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state = self._persistence.load(session_id)

    @classmethod
    def get_instance(cls, session_id: str) -> 'SelfModel':
        if session_id not in cls._instances:
            cls._instances[session_id] = cls(session_id)
        return cls._instances[session_id]

    def update(self, turn_data: dict) -> SelfState:
        now = time.time()
        time_delta = now - self.state.last_updated
        
        # Evolve state continuously
        self.state = SelfDynamics.evolve(self.state, turn_data, time_delta)
        
        # Persist and emit telemetry
        self._persistence.save(self.state)
        SelfTelemetry.emit(self.state)
        
        return self.state
