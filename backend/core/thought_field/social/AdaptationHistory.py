from collections import deque
from .ExpressionStyle import ExpressionStyle

class AdaptationHistory:
    def __init__(self, maxlen: int = 15):
        self.history = deque(maxlen=maxlen)
        
    def append(self, style: ExpressionStyle):
        self.history.append(style)
        
    def get_drift(self, current: ExpressionStyle) -> float:
        if not self.history:
            return 0.0
            
        mismatches = 0
        last = self.history[-1]
        
        # Check how much expression parameters jumped compared to the last frame
        if current.conversational_energy != last.conversational_energy: mismatches += 1
        if current.humor != last.humor: mismatches += 1
        if current.verbosity != last.verbosity: mismatches += 1
        if current.warmth != last.warmth: mismatches += 1
        
        return min(1.0, mismatches / 4.0)
