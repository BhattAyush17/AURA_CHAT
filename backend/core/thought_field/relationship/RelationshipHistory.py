from collections import deque
from typing import List
from .RelationshipState import RelationshipState
from .RelationshipMilestone import RelationshipMilestone

class RelationshipHistory:
    """
    Tracks the long-term evolution of the relationship.
    Only stores high-level relationship states, never raw text.
    Anchors structural turning points as Milestones.
    """
    def __init__(self, maxlen: int = 150):
        self.history = deque(maxlen=maxlen)
        self.milestones: List[RelationshipMilestone] = []
        
    def append(self, state: RelationshipState):
        self.history.append(state)
        
    def add_milestone(self, milestone: RelationshipMilestone):
        self.milestones.append(milestone)
        
    @property
    def total_observations(self) -> int:
        return len(self.history)
        
    @property
    def total_milestones(self) -> int:
        return len(self.milestones)
