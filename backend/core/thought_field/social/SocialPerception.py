from .SocialState import SocialState
from .SocialHistory import SocialHistory
from ..predictive.PredictionState import PredictionState
from ..metacognition.AwarenessHistory import AwarenessHistory

class SocialPerception:
    def __init__(self):
        self.history = SocialHistory()
        
    def perceive(self, 
                 transcript: str, 
                 conversation_metadata: dict, 
                 window, 
                 self_state, 
                 prediction_state: PredictionState,
                 awareness_history: AwarenessHistory,
                 music_context: dict = None) -> SocialState:
        """
        Passive social estimation layer.
        Consumes conversation dynamics and internal state to estimate the human's state.
        Does NOT judge, behave, or modify cognition.
        Exposes an immutable SocialState.
        """
        rms = conversation_metadata.get("audio_rms", 0.0)
        pause = conversation_metadata.get("pause_ms", 500.0)
        
        observations = []
        if transcript and transcript.strip():
            observations.append({"type": "explicit", "content": transcript, "source": "user_speech"})
            
        if music_context:
            observations.append({
                "type": "behavioral", 
                "content": f"Listening to {music_context.get('provider')} track {music_context.get('track_id')} ({music_context.get('state')})", 
                "source": "music_context"
            })
        
        self.history.append(rms, pause, transcript)
        
        # --- 1. Engagement Estimate ---
        # High RMS, fast replies, and long text = high engagement
        engagement = 0.5
        if self.history.is_sufficient():
            if pause < 800 and rms > 0.03:
                engagement = min(1.0, engagement + 0.3)
            elif pause > 3000 and len(transcript) < 15:
                engagement = max(0.0, engagement - 0.3)
                
        # --- 2. Hesitation Estimate ---
        # Long pauses before short answers indicate hesitation
        hesitation = 0.2
        if pause > 2000 and len(transcript) < 30:
            hesitation = min(1.0, hesitation + 0.4)
        elif pause < 500:
            hesitation = max(0.0, hesitation - 0.2)
            
        # --- 3. Conversation Energy ---
        # Derived directly from RMS history
        energy = min(1.0, self.history.average_rms() * 15.0) # Scale RMS up slightly
        
        # --- 4. Emotional & Cognitive Bandwidth ---
        # If human is hesitating and energy is low, emotional bandwidth might be low
        emo_bandwidth = 1.0 - (hesitation * 0.5)
        cog_bandwidth = 1.0 - (self.history.rhythm_variance() * 0.5)
        
        # --- 5. Receptivity Estimates ---
        # Humor Receptivity: Needs high engagement and moderate/high energy
        humor_recept = 0.5
        if engagement > 0.6 and energy > 0.4 and hesitation < 0.3:
            humor_recept = 0.8
        elif hesitation > 0.6:
            humor_recept = 0.2
            
        # Challenge Receptivity: High energy, low hesitation, high cognitive bandwidth
        challenge_recept = 0.5
        if energy > 0.6 and cog_bandwidth > 0.7:
            challenge_recept = 0.8
        elif emo_bandwidth < 0.4:
            challenge_recept = 0.2
            
        # Silence Receptivity: High hesitation, low energy, long pauses
        silence_recept = 0.2
        if pause > 2500 and energy < 0.3:
            silence_recept = 0.9
            
        # --- 6. Comfort & Openness ---
        # Inverse of hesitation and rhythm variance
        comfort = 1.0 - (hesitation * 0.5) - (self.history.rhythm_variance() * 0.2)
        openness = min(1.0, comfort + (engagement * 0.2))
        
        # --- 7. Estimated Social Load ---
        # The weight of the conversation on the human. High energy + High text length
        load = (energy * 0.5) + min(0.5, len(transcript) / 200.0)
        
        # --- 8. Uncertainty & Confidence ---
        # Confidence grows as history builds
        confidence = 0.1
        if self.history.is_sufficient():
            confidence = min(1.0, 0.4 + (len(self.history.frames) * 0.05))
            
        # If confidence is low, uncertainty is high
        uncertainty = 1.0 - confidence
        
        return SocialState(
            engagement_estimate=engagement,
            openness_estimate=openness,
            hesitation_estimate=hesitation,
            emotional_bandwidth_estimate=emo_bandwidth,
            cognitive_bandwidth_estimate=cog_bandwidth,
            conversation_energy_estimate=energy,
            humor_receptivity_estimate=humor_recept,
            challenge_receptivity_estimate=challenge_recept,
            silence_receptivity_estimate=silence_recept,
            comfort_estimate=comfort,
            estimated_social_load=load,
            uncertainty_estimate=uncertainty,
            perception_confidence=confidence,
            observations=observations
        )
