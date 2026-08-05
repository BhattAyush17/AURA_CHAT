from typing import List, Dict

class AwarenessWindow:
    def __init__(self):
        self.capacity: int = 3
        self.conscious_thoughts: List[str] = [] # stores formatted text or summaries of thoughts
        self.emerging_insight: str = ""
        self.attention_direction: str = "Internal"
        self.awareness_summary: str = "Mind is quiet."
        self.suppressed_count: int = 0
        
    def adapt_capacity(self, energy: float, load: float, stress: float):
        # Stress narrows focus (1-2), high energy and low load expands focus (4-6)
        # Default is 3.
        base = 3.0
        base -= (stress * 1.5)
        base += (energy * 1.5)
        base -= (load * 1.0)
        self.capacity = max(1, min(6, int(round(base))))
