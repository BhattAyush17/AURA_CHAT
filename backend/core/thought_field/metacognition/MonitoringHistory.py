from collections import deque
from .ReflectionState import ReflectionState

class MonitoringHistory:
    def __init__(self, max_frames: int = 100):
        # Long-term rolling history
        self.reflections = deque(maxlen=max_frames)
        
    def append(self, state: ReflectionState):
        self.reflections.append(state)
        
    def is_sufficient(self) -> bool:
        return len(self.reflections) >= 5
        
    def average_confidence(self) -> float:
        if not self.reflections: return 0.0
        return sum(r.confidence for r in self.reflections) / len(self.reflections)
        
    def reflection_persistence(self) -> float:
        if not self.reflections: return 0.0
        # What percentage of recent reflections achieved Stable or Settling lifecycle?
        stable_count = sum(1 for r in self.reflections if r.lifecycle_stage in ["Stable", "Settling", "Resolved"])
        return stable_count / len(self.reflections)
        
    def reflection_resolution_rate(self) -> float:
        if not self.reflections: return 0.0
        resolved_count = sum(1 for r in self.reflections if r.lifecycle_stage == "Resolved")
        return resolved_count / len(self.reflections)
        
    def identity_stability(self) -> float:
        if len(self.reflections) < 2: return 1.0
        # Inverse of identity_pressure fluctuation
        fluctuations = sum(abs(self.reflections[i].identity_pressure - self.reflections[i-1].identity_pressure) 
                          for i in range(1, len(self.reflections)))
        avg_fluctuation = fluctuations / (len(self.reflections) - 1)
        return max(0.0, 1.0 - avg_fluctuation)
        
    def attention_drift(self) -> float:
        if len(self.reflections) < 2: return 0.0
        # How often attention pattern shifts
        shifts = sum(1 for i in range(1, len(self.reflections)) if self.reflections[i].attention_pattern != self.reflections[i-1].attention_pattern)
        return shifts / (len(self.reflections) - 1)
        
    def oscillation_index(self) -> float:
        if len(self.reflections) < 3: return 0.0
        # Detect flipping in certainty or emotional direction
        flips = 0
        for i in range(2, len(self.reflections)):
            prev = self.reflections[i-1].certainty_direction
            curr = self.reflections[i].certainty_direction
            before_prev = self.reflections[i-2].certainty_direction
            if curr == before_prev and curr != prev and curr != "stable" and prev != "stable":
                flips += 1
        return min(1.0, flips / max(1, (len(self.reflections) / 2)))
