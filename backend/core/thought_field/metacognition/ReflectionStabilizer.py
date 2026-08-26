import time
from collections import deque
from .ReflectionState import ReflectionState
from .ReflectionLifecycle import ReflectionLifecycle
from .ReflectionPattern import ReflectionPattern

class ReflectionStabilizer:
    def __init__(self):
        # Small bounded history
        self.raw_history = deque(maxlen=5)
        self.patterns = {} # theme -> ReflectionPattern
        self.current_lifecycle = ReflectionLifecycle.EMERGING
        self.confidence = 0.1
        self.coherence = "Stable"
        
    def stabilize(self, raw_state: dict, self_state, dominant_theme: str) -> ReflectionState:
        """
        Takes raw interpretations from SelfReflection, detects coherence and recurrences,
        and manages the structural maturation (lifecycle) of the reflection itself.
        """
        current_time = time.time()
        self.raw_history.append(raw_state)
        
        # 1. Manage Recurrences (ReflectionPattern)
        if dominant_theme:
            if dominant_theme not in self.patterns:
                self.patterns[dominant_theme] = ReflectionPattern(theme=dominant_theme, last_seen_timestamp=current_time)
            else:
                self.patterns[dominant_theme].touch(current_time)
                
        # Decay old patterns
        to_delete = []
        for theme, pattern in self.patterns.items():
            if theme != dominant_theme:
                pattern.decay()
                if pattern.persistence <= 0.01:
                    to_delete.append(theme)
        for t in to_delete:
            del self.patterns[t]
            
        active_pattern = self.patterns.get(dominant_theme)
        recurrence_strength = active_pattern.persistence if active_pattern else 0.0
        
        # 2. Evaluate Coherence (Internal disagreement)
        # If certainty flips rapidly, it's fragmented.
        certainty_flips = 0
        if len(self.raw_history) >= 2:
            prev = None
            for s in self.raw_history:
                if prev and s["certainty_direction"] != prev["certainty_direction"] and s["certainty_direction"] != "stable" and prev["certainty_direction"] != "stable":
                    certainty_flips += 1
                prev = s
                
        if certainty_flips >= 2:
            self.coherence = "Fragmented"
        elif certainty_flips == 1:
            self.coherence = "Conflicted"
        else:
            if recurrence_strength > 0.5:
                self.coherence = "Converging"
            else:
                self.coherence = "Stable"
                
        # 3. Reflection Confidence (Grows with coherence and stability, shrinks with fragmentation)
        if self.coherence == "Converging":
            self.confidence = min(1.0, self.confidence + 0.1)
        elif self.coherence == "Stable":
            self.confidence = min(1.0, self.confidence + 0.05)
        elif self.coherence == "Conflicted":
            self.confidence = max(0.0, self.confidence - 0.1)
        elif self.coherence == "Fragmented":
            self.confidence = max(0.0, self.confidence - 0.2)
            
        # 4. Lifecycle Evolution
        if self.confidence > 0.8 and recurrence_strength > 0.6:
            self.current_lifecycle = ReflectionLifecycle.STABLE
        elif self.confidence > 0.5:
            self.current_lifecycle = ReflectionLifecycle.GROWING
        elif self.confidence < 0.2 and self.current_lifecycle in [ReflectionLifecycle.STABLE, ReflectionLifecycle.GROWING]:
            self.current_lifecycle = ReflectionLifecycle.SETTLING
        elif self.confidence < 0.05 and self.current_lifecycle == ReflectionLifecycle.SETTLING:
            self.current_lifecycle = ReflectionLifecycle.RESOLVED
            
        # Build Final Frozen ReflectionState
        state = ReflectionState(
            certainty_direction=raw_state["certainty_direction"],
            attention_pattern=raw_state["attention_pattern"],
            emotional_direction=raw_state["emotional_direction"],
            unresolvedness=raw_state["unresolvedness"],
            identity_pressure=raw_state["identity_pressure"],
            reflection_depth=raw_state["reflection_depth"],
            internal_stability=raw_state["internal_stability"],
            dominant_transition=raw_state["dominant_transition"],
            lifecycle_stage=self.current_lifecycle.name.capitalize(),
            confidence=self.confidence,
            coherence=self.coherence,
            recurrence_strength=recurrence_strength
        )
        
        # 5. Passive Influence based on stable reflection
        if self.current_lifecycle == ReflectionLifecycle.STABLE:
            if state.certainty_direction == "weakening":
                self_state.comfort = max(0.0, self_state.comfort - 0.01)
            elif state.certainty_direction == "strengthening":
                self_state.comfort = min(1.0, self_state.comfort + 0.01)
                
            if state.attention_pattern == "scattered":
                self_state.cognitive_load = min(1.0, self_state.cognitive_load + 0.02)
                
            if state.emotional_direction == "escalating":
                self_state.reflection_depth = min(1.0, self_state.reflection_depth + 0.01)
                
        return state
