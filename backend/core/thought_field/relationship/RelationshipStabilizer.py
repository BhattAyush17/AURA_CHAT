from .RelationshipState import RelationshipState
from .RelationshipMilestone import RelationshipMilestone
from .RelationshipConfidence import RelationshipConfidence
from .RelationshipInertia import RelationshipInertia
from .RelationshipResilience import RelationshipResilience
from .RelationshipRecovery import RelationshipRecovery
from ..social.SocialModelState import SocialModelState
from ..predictive.PredictionState import PredictionState
from ..self_model.SelfState import SelfState
import time

class RelationshipStabilizer:
    def stabilize(self, 
                  current_relationship: RelationshipState, 
                  social_model: SocialModelState, 
                  prediction: PredictionState, 
                  self_state: SelfState, 
                  history_size: int,
                  history_log) -> RelationshipState:
        """
        Evolves relationship parameters based on accumulated long-term models.
        Relationship evolves extremely slowly compared to social adaptation.
        """
        # Very slow learning rate: Relationship changes take weeks/months
        lr = max(0.005, 0.05 - (history_size * 0.0002))
        
        def lerp(belief, evidence, rate=lr):
            return belief + (evidence - belief) * rate
            
        # 1. Update Core Stabilization Parameters
        elapsed_time = time.time() - current_relationship.timestamp
        new_confidence = RelationshipConfidence.evaluate(current_relationship, social_model, history_size, elapsed_time)
        
        # 2. Trust & Psychological Safety with Resilience and Inertia
        trust_evidence = social_model.conversation_predictability * (1.0 - (1.0 if prediction.expected_identity_pressure == "building" else 0.0))
        trust_drop = max(0.0, current_relationship.trust_level - trust_evidence)
        trust_gain = max(0.0, trust_evidence - current_relationship.trust_level)
        
        new_recovery = RelationshipRecovery.evaluate(current_relationship, trust_gain, trust_drop)
        new_resilience = RelationshipResilience.evaluate(current_relationship, trust_drop)
        
        # Determine actual learning rate for trust
        # If dropping, resilience protects it. If growing, confidence makes it stickier (inertia-like).
        if trust_evidence < current_relationship.trust_level:
            effective_lr = lr * (1.0 - current_relationship.relationship_resilience)
        else:
            effective_lr = lr * (1.0 - current_relationship.relationship_confidence)
            
        new_trust = lerp(current_relationship.trust_level, trust_evidence, effective_lr)
        
        safety_evidence = social_model.relationship_comfort * social_model.model_confidence
        new_safety = lerp(current_relationship.psychological_safety, safety_evidence, lr * (1.0 - current_relationship.relationship_confidence))
        
        # 3. Familiarity & Shared Dynamics
        # Drift logic: Familiarity barely changes over long inactivity, otherwise increments slightly.
        fam_inc = 0.0001 if elapsed_time > 86400 else 0.001
        new_familiarity = min(1.0, current_relationship.familiarity + fam_inc)
        new_humor = lerp(current_relationship.shared_humor, social_model.humor_preference, lr)
        
        # 4. Synchrony & Reciprocity
        comfort_diff = abs(self_state.comfort - social_model.relationship_comfort)
        sync_evidence = 1.0 - comfort_diff
        new_sync = lerp(current_relationship.emotional_synchrony, sync_evidence, lr)
        
        # 5. Momentum, Direction & Inertia
        momentum = (new_trust - current_relationship.trust_level) + (new_familiarity - current_relationship.familiarity)
        raw_momentum = 0.5 + momentum * 10
        new_momentum = lerp(current_relationship.relationship_momentum, raw_momentum, lr)
        
        new_inertia = RelationshipInertia.evaluate(current_relationship, new_momentum)
        
        # If inertia is very high, momentum stays near 0.5 (neutral)
        if current_relationship.relationship_inertia > 0.8:
            new_momentum = lerp(new_momentum, 0.5, 0.1)
            
        direction = "neutral"
        if new_momentum > 0.55: direction = "deepening"
        elif new_momentum < 0.45: direction = "distancing"
        
        # 6. Milestone Generation (Passive)
        # E.g. First sustained trust
        if new_trust > 0.8 and current_relationship.trust_level <= 0.8:
            history_log.add_milestone(RelationshipMilestone(
                milestone_type="first_sustained_trust",
                relationship_impact=0.8,
                confidence=new_confidence
            ))
        elif trust_drop > 0.15:
            history_log.add_milestone(RelationshipMilestone(
                milestone_type="major_disagreement",
                relationship_impact=-0.5,
                confidence=new_confidence
            ))
        
        return RelationshipState(
            trust_level=new_trust,
            familiarity=new_familiarity,
            psychological_safety=new_safety,
            relationship_comfort=lerp(current_relationship.relationship_comfort, social_model.relationship_comfort, lr),
            conflict_recovery_capacity=current_relationship.conflict_recovery_capacity,
            shared_humor=new_humor,
            shared_language=current_relationship.shared_language,
            reciprocity=current_relationship.reciprocity,
            emotional_synchrony=new_sync,
            attachment_stability=current_relationship.attachment_stability,
            relationship_momentum=new_momentum,
            interaction_confidence=lerp(current_relationship.interaction_confidence, social_model.model_confidence, lr),
            relationship_confidence=new_confidence,
            relationship_inertia=new_inertia,
            relationship_resilience=new_resilience,
            relationship_recovery=new_recovery,
            relationship_direction=direction
        )
