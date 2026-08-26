import time
from .EnvironmentState import EnvironmentState
from .FieldDynamics import FieldDynamics
from .FieldPersistence import FieldPersistence
from .FieldTelemetry import FieldTelemetry
from backend.core.thought_field.self_model import SelfState

class Environment:
    _instances = {}
    _persistence = FieldPersistence()

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state = self._persistence.load(session_id)

    @classmethod
    def get_instance(cls, session_id: str) -> 'Environment':
        if session_id not in cls._instances:
            cls._instances[session_id] = cls(session_id)
        return cls._instances[session_id]

    def tick(self, self_state: SelfState) -> EnvironmentState:
        now = time.time()
        time_delta = now - self.state.last_updated
        
        self.state = FieldDynamics.evolve(self.state, self_state, time_delta)
        self.state.last_updated = now
        
        self._persistence.save(self.state)
        FieldTelemetry.emit(self.state)
        
        return self.state
