from collections import deque
from typing import List
from .AwarenessFrame import AwarenessFrame

class AwarenessHistory:
    def __init__(self, max_frames: int = 20):
        # O(1) append and pruning
        self.frames = deque(maxlen=max_frames)
        
    def append(self, frame: AwarenessFrame):
        self.frames.append(frame)
        
    def is_sufficient(self) -> bool:
        return len(self.frames) >= 3

    def average_reflection(self) -> float:
        if not self.frames: return 0.0
        return sum(f.reflection_depth for f in self.frames) / len(self.frames)
        
    def reflection_trend(self) -> float:
        if len(self.frames) < 2: return 0.0
        # Positive = increasing, Negative = decreasing
        return self.frames[-1].reflection_depth - self.frames[0].reflection_depth
        
    def average_confidence(self) -> float:
        if not self.frames: return 0.0
        return sum(f.confidence for f in self.frames) / len(self.frames)
        
    def confidence_trend(self) -> float:
        if len(self.frames) < 2: return 0.0
        return self.frames[-1].confidence - self.frames[0].confidence
        
    def attention_stability(self) -> float:
        if len(self.frames) < 2: return 1.0
        # Ratio of times the attention direction remained the same
        stable_transitions = sum(1 for i in range(1, len(self.frames)) 
                               if self.frames[i].attention_direction == self.frames[i-1].attention_direction)
        return stable_transitions / (len(self.frames) - 1)
        
    def focus_persistence(self) -> float:
        if not self.frames: return 0.0
        return sum(1 for f in self.frames if f.awareness_width < 3) / len(self.frames)
        
    def theme_persistence(self) -> float:
        if len(self.frames) < 2: return 1.0
        # Check how often dominant theme remains the same
        stable_transitions = sum(1 for i in range(1, len(self.frames)) 
                               if self.frames[i].dominant_theme and self.frames[i].dominant_theme == self.frames[i-1].dominant_theme)
        return stable_transitions / (len(self.frames) - 1)
        
    def tension_growth(self) -> float:
        if len(self.frames) < 2: return 0.0
        return self.frames[-1].internal_tension - self.frames[0].internal_tension
        
    def cognitive_load_trend(self) -> float:
        if len(self.frames) < 2: return 0.0
        return self.frames[-1].cognitive_load - self.frames[0].cognitive_load

    def average_density(self) -> float:
        if not self.frames: return 0.0
        return sum(f.awareness_density for f in self.frames) / len(self.frames)
