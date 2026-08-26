from .SocialModelState import SocialModelState
from .SocialModelHistory import SocialModelHistory
from .SocialModelStabilizer import SocialModelStabilizer
from .SocialState import SocialState

class SocialModel:
    def __init__(self):
        self.state = SocialModelState() # starts at neutral baseline
        self.history = SocialModelHistory()
        self.stabilizer = SocialModelStabilizer()
        
    def ingest_evidence(self, evidence: SocialState) -> SocialModelState:
        """
        Receives the transient SocialState.
        Accumulates it into history and gradually stabilizes the internal model.
        Returns the updated immutable SocialModelState.
        """
        self.history.append_evidence(evidence)
        
        self.state = self.stabilizer.stabilize(
            current_model=self.state,
            evidence=evidence,
            history_size=self.history.total_evidence
        )
        
        return self.state
