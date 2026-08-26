from .MetacognitiveObservation import MetacognitiveObservation
from .AwarenessHistory import AwarenessHistory

class MetacognitiveObserver:
    def __init__(self):
        self.latest_observation = None

    def observe(self, window, awareness_history: AwarenessHistory, self_state, presence, env_fields) -> MetacognitiveObservation:
        """
        Pure observation of the conscious state trajectory.
        Does not read ThoughtNodes, Graph, or Ecology.
        Runs in <1ms.
        """
        # 1. Derive Patterns if enough history exists
        if not awareness_history.is_sufficient():
            return None

        # Pattern: Sustained Narrow Attention
        avg_width = sum(f.awareness_width for f in awareness_history.frames) / len(awareness_history.frames)
        if avg_width < 2.5 and awareness_history.focus_persistence() > 0.7:
            obs = MetacognitiveObservation(
                observation_type="SustainedFocus",
                confidence=0.8,
                intensity=1.0 - (avg_width / 3.0),
                summary="Attention feels unusually narrow and persistent.",
                emotional_context="Restricted"
            )
            return self._apply_nudge(obs, self_state)

        # Pattern: Scattered Attention
        if avg_width >= 4.5 and awareness_history.focus_persistence() < 0.2:
            obs = MetacognitiveObservation(
                observation_type="ScatteredAttention",
                confidence=0.7,
                intensity=(avg_width - 3.0) / 3.0,
                summary="Current thinking feels scattered and highly active.",
                emotional_context="Overloaded"
            )
            return self._apply_nudge(obs, self_state)

        # Pattern: Persistent Cognitive Tension
        if awareness_history.tension_growth() > 0.1 or sum(f.internal_tension for f in awareness_history.frames) / len(awareness_history.frames) > 0.6:
            obs = MetacognitiveObservation(
                observation_type="PersistentTension",
                confidence=0.8,
                intensity=sum(f.internal_tension for f in awareness_history.frames) / len(awareness_history.frames),
                summary="There is unresolved, growing internal tension.",
                emotional_context="Tense"
            )
            return self._apply_nudge(obs, self_state)

        # Pattern: Elevated Reflection
        if awareness_history.average_reflection() > 0.6 and awareness_history.reflection_trend() >= 0:
            obs = MetacognitiveObservation(
                observation_type="ElevatedReflection",
                confidence=0.8,
                intensity=awareness_history.average_reflection(),
                summary="Reflection has remained elevated and stable.",
                emotional_context="Deep"
            )
            return self._apply_nudge(obs, self_state)
            
        # Pattern: Declining Confidence
        if awareness_history.average_confidence() < 0.5 and awareness_history.confidence_trend() < -0.1:
            obs = MetacognitiveObservation(
                observation_type="DecliningConfidence",
                confidence=0.7,
                intensity=abs(awareness_history.confidence_trend()),
                summary="Confidence appears to be declining.",
                emotional_context="Uncertain"
            )
            return self._apply_nudge(obs, self_state)
            
        # Default empty observation if no pattern detected
        return None

    def _apply_nudge(self, obs: MetacognitiveObservation, self_state) -> MetacognitiveObservation:
        """
        Passive Influence Only. (Rule 5)
        Nudges self_state slightly based on observation.
        Does not manipulate the ecology.
        """
        self.latest_observation = obs
        
        if obs.observation_type == "SustainedFocus":
            # Nudge: slightly increase cognitive load as focus burns energy
            self_state.cognitive_load = min(1.0, self_state.cognitive_load + 0.05)
        elif obs.observation_type == "ScatteredAttention":
            # Nudge: slightly reduce attention bandwidth due to context switching
            self_state.attention_bandwidth = max(0.0, self_state.attention_bandwidth - 0.05)
        elif obs.observation_type == "PersistentTension":
            # Nudge: slightly decrease comfort
            self_state.comfort = max(0.0, self_state.comfort - 0.05)
        elif obs.observation_type == "ElevatedReflection":
            # Nudge: slightly increase reflection depth momentum
            self_state.reflection_depth = min(1.0, self_state.reflection_depth + 0.05)
        elif obs.observation_type == "DecliningConfidence":
            # Nudge: slightly increase uncertainty
            self_state.comfort = max(0.0, self_state.comfort - 0.05)
            
        return obs
