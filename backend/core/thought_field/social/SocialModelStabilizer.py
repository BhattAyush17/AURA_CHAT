from .SocialState import SocialState
from .SocialModelState import SocialModelState

class SocialModelStabilizer:
    """
    Gradually updates the internal SocialModel by accumulating evidence from SocialState.
    Prevents abrupt behavioral changes.
    """
    def __init__(self):
        pass

    def stabilize(self, current_model: SocialModelState, evidence: SocialState, history_size: int) -> SocialModelState:
        # Learning rate decays as history grows, bounded to a minimum
        learning_rate = max(0.01, 0.1 - (history_size * 0.0005))
        
        # Helper to smoothly interpolate between current belief and new evidence
        def lerp(belief, new_evidence):
            return belief + (new_evidence - belief) * learning_rate
            
        # 1. Evaluate consistency & contradiction
        # If new evidence strongly contradicts current model, confidence drops.
        # If it aligns, confidence increases.
        energy_diff = abs(current_model.conversation_energy_preference - evidence.conversation_energy_estimate)
        humor_diff = abs(current_model.humor_preference - evidence.humor_receptivity_estimate)
        
        contradiction = (energy_diff + humor_diff) / 2.0
        
        # Confidence update: grows slowly if contradiction is low, drops if high
        new_confidence = current_model.model_confidence
        if contradiction < 0.2:
            new_confidence = min(1.0, new_confidence + 0.02)
        elif contradiction > 0.5:
            new_confidence = max(0.1, new_confidence - 0.05)
            
        # 2. Incrementally update preferences
        new_humor = lerp(current_model.humor_preference, evidence.humor_receptivity_estimate)
        new_challenge = lerp(current_model.challenge_preference, evidence.challenge_receptivity_estimate)
        new_energy = lerp(current_model.conversation_energy_preference, evidence.conversation_energy_estimate)
        
        # Derive indirect preferences from evidence combinations
        # E.g., high engagement + high energy = lower formality
        implied_formality = 1.0 - (evidence.engagement_estimate * 0.5 + evidence.conversation_energy_estimate * 0.5)
        new_formality = lerp(current_model.formality_preference, implied_formality)
        
        # Comfort & Silence
        new_comfort = lerp(current_model.relationship_comfort, evidence.comfort_estimate)
        new_silence = lerp(current_model.silence_comfort_preference, evidence.silence_receptivity_estimate)
        
        # Predictability decreases if contradiction is high
        new_predictability = lerp(current_model.conversation_predictability, 1.0 - contradiction)
        
        return SocialModelState(
            humor_preference=new_humor,
            challenge_preference=new_challenge,
            explanation_depth_preference=current_model.explanation_depth_preference, # stable for now
            conversation_energy_preference=new_energy,
            formality_preference=new_formality,
            directness_preference=current_model.directness_preference, # stable
            verbosity_preference=current_model.verbosity_preference,
            emotional_validation_preference=current_model.emotional_validation_preference,
            technical_density_preference=current_model.technical_density_preference,
            silence_comfort_preference=new_silence,
            conversation_pace_preference=current_model.conversation_pace_preference,
            curiosity_level_preference=current_model.curiosity_level_preference,
            playfulness_preference=current_model.playfulness_preference,
            reflection_depth_preference=current_model.reflection_depth_preference,
            relationship_comfort=new_comfort,
            trust_stability=current_model.trust_stability,
            conversation_predictability=new_predictability,
            model_confidence=new_confidence
        )
