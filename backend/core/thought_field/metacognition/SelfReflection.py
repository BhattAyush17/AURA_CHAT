from .AwarenessHistory import AwarenessHistory
from .MetacognitiveObservation import MetacognitiveObservation
from .AwarenessFrame import ContextTransition

class SelfReflection:
    def reflect(self, history: AwarenessHistory, observation: MetacognitiveObservation, self_state) -> dict:
        """
        Interprets trajectories into an internal ReflectionState.
        Never generates text or prompts.
        Applies microscopic nudges to SelfState.
        """
        # Default state
        certainty = "stable"
        attention = "stable"
        emotion = "stable"
        
        # Analyze trajectory from history
        if history.is_sufficient():
            conf_trend = history.confidence_trend()
            if conf_trend < -0.1: certainty = "weakening"
            elif conf_trend > 0.1: certainty = "strengthening"
            
            tension_growth = history.tension_growth()
            if tension_growth > 0.1: emotion = "escalating"
            elif tension_growth < -0.1: emotion = "settling"
            
            att_stab = history.attention_stability()
            if att_stab < 0.3: attention = "scattered"
            elif att_stab > 0.8 and history.focus_persistence() > 0.7: attention = "narrowing"
            
        unresolvedness = history.tension_growth() if history.is_sufficient() else 0.0
        identity_pressure = history.average_reflection() if history.is_sufficient() else 0.0
        
        dominant_transition = ContextTransition.NONE
        if history.is_sufficient():
            # Count transition types to find dominant
            transitions = [f.context_transition for f in history.frames if f.context_transition != ContextTransition.NONE]
            if transitions:
                dominant_transition = max(set(transitions), key=transitions.count)
                
        # Build raw state dict
        return {
            "certainty_direction": certainty,
            "attention_pattern": attention,
            "unresolvedness": max(0.0, unresolvedness),
            "identity_pressure": identity_pressure,
            "emotional_direction": emotion,
            "reflection_depth": self_state.reflection_depth,
            "internal_stability": history.attention_stability() if history.is_sufficient() else 1.0,
            "dominant_transition": dominant_transition
        }
