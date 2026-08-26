from .SelfState import SelfState

class SelfDynamics:
    @staticmethod
    def evolve(state: SelfState, turn_data: dict, time_delta: float) -> SelfState:
        state.last_updated += time_delta
        return state
