from .EnvironmentState import EnvironmentState
from backend.core.thought_field.self_model import SelfState

class FieldDynamics:
    @staticmethod
    def evolve(state: EnvironmentState, self_state: SelfState, time_delta: float) -> EnvironmentState:
        # Time-based decay towards baseline
        for field in state.fields.values():
            diff = field.target_baseline - field.intensity
            field.intensity += diff * field.recovery_rate * (time_delta / 60.0) # recover per minute
            field.intensity = max(0.0, min(1.0, field.intensity))

        # SelfModel Influence
        # High cognitive load narrows attention, raises urgency
        if self_state.cognitive_load > 0.7:
            if "attention" in state.fields:
                state.fields["attention"].intensity = min(1.0, state.fields["attention"].intensity + 0.1)
            if "urgency" in state.fields:
                state.fields["urgency"].intensity = min(1.0, state.fields["urgency"].intensity + 0.05)
            if "reflection" in state.fields:
                state.fields["reflection"].intensity = max(0.0, state.fields["reflection"].intensity - 0.1)

        # High curiosity expands novelty
        if self_state.curiosity > 0.6 and "novelty" in state.fields:
            state.fields["novelty"].intensity = min(1.0, state.fields["novelty"].intensity + 0.05)

        # Low energy reduces reflection
        if self_state.mental_energy < 0.3:
            if "reflection" in state.fields:
                state.fields["reflection"].intensity = max(0.0, state.fields["reflection"].intensity - 0.05)
            if "urgency" in state.fields:
                state.fields["urgency"].intensity = max(0.0, state.fields["urgency"].intensity - 0.05)

        # High comfort expands identity
        if self_state.comfort > 0.7:
            if "identity" in state.fields:
                state.fields["identity"].intensity = min(1.0, state.fields["identity"].intensity + 0.02)
            if "uncertainty" in state.fields:
                state.fields["uncertainty"].intensity = max(0.0, state.fields["uncertainty"].intensity - 0.05)

        # Silence (time_delta) expands reflection
        if time_delta > 10.0 and "reflection" in state.fields:
            state.fields["reflection"].intensity = min(1.0, state.fields["reflection"].intensity + (time_delta/600.0))

        # Cross-Field Interactions (Ecology Rebalancing)
        if "reflection" in state.fields and "urgency" in state.fields:
            refl = state.fields["reflection"].intensity
            if refl > 0.6:
                state.fields["urgency"].intensity = max(0.0, state.fields["urgency"].intensity - (refl * 0.1))

            urg = state.fields["urgency"].intensity
            if urg > 0.7 and "curiosity_field" in state.fields:
                state.fields["curiosity_field"].intensity = max(0.0, state.fields["curiosity_field"].intensity - (urg * 0.1))

        return state
