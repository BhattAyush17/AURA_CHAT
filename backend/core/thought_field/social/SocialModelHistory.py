from collections import deque
from .SocialState import SocialState

class SocialModelHistory:
    """
    Stores up to 100 high-level social observations (SocialState) to provide evidence
    for the SocialModelStabilizer.
    """
    def __init__(self, maxlen: int = 100):
        self.evidence_log = deque(maxlen=maxlen)
        
    def append_evidence(self, state: SocialState):
        self.evidence_log.append(state)
        
    def get_recent_evidence(self, count: int = 10) -> list:
        # Return up to 'count' recent states
        start_idx = max(0, len(self.evidence_log) - count)
        return list(self.evidence_log)[start_idx:]
        
    @property
    def total_evidence(self) -> int:
        return len(self.evidence_log)
