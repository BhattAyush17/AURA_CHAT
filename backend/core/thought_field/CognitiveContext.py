from dataclasses import dataclass, field
import time
from typing import Optional, Dict

@dataclass
class CognitiveContext:
    session_id: str
    transcript: str
    current_time: float = field(default_factory=time.time)
    conversation_metadata: Dict = field(default_factory=dict)
    runtime_signals: Dict = field(default_factory=dict)
    music_context: Optional[Dict] = None

