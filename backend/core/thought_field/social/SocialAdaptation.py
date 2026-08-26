from .SocialState import SocialState
from .SocialModelState import SocialModelState
from .ExpressionStyle import ExpressionStyle
from .AdaptationHistory import AdaptationHistory
from ..predictive.PredictionState import PredictionState
from ..self_model.SelfState import SelfState

class SocialAdaptation:
    def __init__(self):
        self.history = AdaptationHistory()
        
    def adapt(self, 
              social_model_state: SocialModelState,
              social_state: SocialState, 
              self_state: SelfState,
              prediction_state: PredictionState,
              active_mode: str) -> ExpressionStyle:
        """
        The Social Resonance layer.
        Translates the long-term SocialModel and the transient SocialState into active conversational expression without modifying cognition.
        Returns an immutable ExpressionStyle.
        """
        
        # 1. Base Adaptation Variables (driven primarily by long-term model)
        # We blend 80% model, 20% state for a slight contextual local adjustment
        energy_level = (social_model_state.conversation_energy_preference * 0.8) + (social_state.conversation_energy_estimate * 0.2)
        challenge = (social_model_state.challenge_preference * 0.8) + (social_state.challenge_receptivity_estimate * 0.2)
        humor_recep = (social_model_state.humor_preference * 0.8) + (social_state.humor_receptivity_estimate * 0.2)
        engagement = (social_model_state.conversation_predictability * 0.5) + (social_state.engagement_estimate * 0.5)
        comfort = social_model_state.relationship_comfort
        
        # 2. Derive Expressive Features
        pacing = "moderate"
        if energy_level > 0.7: pacing = "fast"
        elif energy_level < 0.3: pacing = "slow"
            
        verbosity = "balanced"
        sentence_length = "medium"
        if engagement < 0.4:
            verbosity = "concise"
            sentence_length = "short"
        elif engagement > 0.8:
            verbosity = "expansive"
            sentence_length = "variable"
            
        directness = "straightforward"
        if challenge < 0.3:
            directness = "softened"
        elif challenge > 0.7:
            directness = "blunt"
            
        humor = "none"
        if humor_recep > 0.7:
            humor = "high"
        elif humor_recep > 0.4:
            humor = "subtle"
            
        warmth = "neutral"
        if comfort > 0.7: warmth = "high"
        elif comfort < 0.3: warmth = "reserved"
            
        # 3. Apply Personality Mode Overrides (Identity Guardrails)
        mode = active_mode.lower()
        
        if mode == "chaotic":
            # Chaotic mode unlocks full expressive freedom, amplifying high energy/humor
            profanity_tolerance = "unrestricted"
            technical_depth = "casual"
            interruption_style = "natural"
            if energy_level > 0.5:
                pacing = "rapid_fire"
                directness = "blunt"
            if humor_recep > 0.5:
                humor = "absurd_and_roasting"
                
        elif mode == "supportive" or mode == "caring":
            profanity_tolerance = "none"
            directness = "gentle"
            warmth = "maximum"
            humor = "none" if mode == "caring" else "light"
            technical_depth = "accessible"
            interruption_style = "never"
            
        elif mode == "genz":
            profanity_tolerance = "casual"
            technical_depth = "casual"
            interruption_style = "natural"
            if humor_recep > 0.4: humor = "meme_heavy"
            
        elif mode == "balanced":
            profanity_tolerance = "minimal"
            interruption_style = "polite"
            technical_depth = "adaptive"
            # Keeps the natural adaptation from Step 2
            
        else: # adaptive or fallback
            profanity_tolerance = "mirror_user"
            technical_depth = "adaptive"
            interruption_style = "natural"
            
        # 4. Synthesize Confidence
        # Adaptation confidence is tightly coupled to the model's confidence
        confidence = social_model_state.model_confidence
        
        # 5. Build Immutable Style
        style = ExpressionStyle(
            mode_profile=mode,
            vocabulary_level="casual" if mode in ["chaotic", "genz"] else "adaptive",
            sentence_length=sentence_length,
            verbosity=verbosity,
            pacing=pacing,
            directness=directness,
            warmth=warmth,
            humor=humor,
            sarcasm="high" if mode == "chaotic" and humor_recep > 0.6 else "none",
            profanity_tolerance=profanity_tolerance,
            conversational_energy="high" if energy_level > 0.7 else ("low" if energy_level < 0.3 else "moderate"),
            challenge_level="high" if challenge > 0.7 and mode == "chaotic" else "adaptive",
            technical_depth=technical_depth,
            interruption_style=interruption_style,
            emotional_intensity="high" if self_state.emotional_inertia > 0.7 else "moderate",
            adaptation_confidence=confidence
        )
        
        # 6. Telemetry & History
        drift = self.history.get_drift(style)
        self.history.append(style)
        
        return style, drift
