from collections import deque
import time
from dataclasses import dataclass, field

@dataclass(frozen=True)
class ConversationFrame:
    audio_rms: float
    pause_ms: float
    text_length: int
    timestamp: float = field(default_factory=time.time)

class SocialHistory:
    def __init__(self, maxlen: int = 20):
        self.frames = deque(maxlen=maxlen)
        
    def append(self, rms: float, pause_ms: float, text: str):
        self.frames.append(ConversationFrame(
            audio_rms=rms,
            pause_ms=pause_ms,
            text_length=len(text)
        ))
        
    def is_sufficient(self) -> bool:
        return len(self.frames) >= 3
        
    def average_rms(self) -> float:
        if not self.frames: return 0.0
        return sum(f.audio_rms for f in self.frames) / len(self.frames)
        
    def average_pause(self) -> float:
        if not self.frames: return 0.0
        return sum(f.pause_ms for f in self.frames) / len(self.frames)
        
    def rhythm_variance(self) -> float:
        if len(self.frames) < 2: return 0.0
        avg_pause = self.average_pause()
        variance = sum((f.pause_ms - avg_pause) ** 2 for f in self.frames) / len(self.frames)
        return min(1.0, variance / 5000.0) # Normalized roughly against 5 seconds variance
