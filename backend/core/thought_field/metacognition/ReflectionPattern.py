from dataclasses import dataclass

@dataclass
class ReflectionPattern:
    theme: str
    recurrence_count: int = 1
    persistence: float = 0.1
    novelty: float = 1.0
    last_seen_timestamp: float = 0.0
    
    def touch(self, current_time: float):
        self.recurrence_count += 1
        self.persistence = min(1.0, self.persistence + 0.1)
        self.novelty = max(0.0, self.novelty - 0.1)
        self.last_seen_timestamp = current_time
        
    def decay(self, amount: float = 0.05):
        self.persistence = max(0.0, self.persistence - amount)
        self.novelty = min(1.0, self.novelty + (amount / 2))
