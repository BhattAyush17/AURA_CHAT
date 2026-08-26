from .RelationshipState import RelationshipState
from .RelationshipHistory import RelationshipHistory
from .RelationshipStabilizer import RelationshipStabilizer
from ..social.SocialModelState import SocialModelState
from ..predictive.PredictionState import PredictionState
from ..self_model.SelfState import SelfState

class RelationshipCognition:
    def __init__(self):
        self.state = RelationshipState()
        self.history = RelationshipHistory()
        self.stabilizer = RelationshipStabilizer()
        
    def experience(self, 
                   social_model: SocialModelState, 
                   prediction: PredictionState, 
                   self_state: SelfState) -> RelationshipState:
        """
        Receives updated cognitive inputs to slowly evolve the interpersonal relationship.
        Returns immutable RelationshipState.
        """
        self.state = self.stabilizer.stabilize(
            current_relationship=self.state,
            social_model=social_model,
            prediction=prediction,
            self_state=self_state,
            history_size=self.history.total_observations,
            history_log=self.history
        )
        
        self.history.append(self.state)
        
        return self.state
