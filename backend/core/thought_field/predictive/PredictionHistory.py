from collections import deque
from .PredictionState import PredictionState

class PredictionHistory:
    def __init__(self, maxlen: int = 10):
        self.history = deque(maxlen=maxlen)
        
    def append(self, state: PredictionState):
        self.history.append(state)
        
    def get_stability(self, current_prediction: PredictionState) -> float:
        if not self.history:
            return 1.0
            
        mismatches = 0
        for prev in self.history:
            if prev.expected_attention != current_prediction.expected_attention: mismatches += 1
            if prev.expected_emotional_momentum != current_prediction.expected_emotional_momentum: mismatches += 1
            
        return max(0.0, 1.0 - (mismatches / (len(self.history) * 2)))
