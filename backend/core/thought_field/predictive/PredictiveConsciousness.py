from .PredictionState import PredictionState
from .PredictionHistory import PredictionHistory
from ..metacognition.ReflectionState import ReflectionState
from ..metacognition.MonitoringState import MonitoringState
from ..metacognition.AwarenessHistory import AwarenessHistory

class PredictiveConsciousness:
    def __init__(self):
        self.history = PredictionHistory()
        
    def predict(self, 
                reflection_state: ReflectionState, 
                monitoring_state: MonitoringState, 
                self_state, 
                awareness_history: AwarenessHistory, 
                window) -> PredictionState:
        """
        Passive trajectory estimation layer.
        Consumes metacognitive states to estimate the near-future evolution of AURA's cognition.
        Does NOT modify any state. Exposes an immutable PredictionState.
        """
        
        # --- 1. Expected Attention ---
        expected_attention = "stable"
        if reflection_state.attention_pattern == "narrowing" and monitoring_state.curiosity_trend < 0.3:
            expected_attention = "drifting_inward"
        elif reflection_state.attention_pattern == "scattered" or monitoring_state.curiosity_trend > 0.6:
            expected_attention = "drifting_outward"
            
        # --- 2. Expected Reflection ---
        expected_reflection = "stable"
        if monitoring_state.cognitive_fatigue > 0.6:
            expected_reflection = "surfacing"
        elif reflection_state.certainty_direction == "weakening" and monitoring_state.oscillation_index < 0.4:
            expected_reflection = "deepening"
            
        # --- 3. Expected Emotional Momentum ---
        expected_momentum = "stable"
        if reflection_state.emotional_direction == "escalating":
            if monitoring_state.cognitive_fatigue > 0.7:
                expected_momentum = "decelerating"
            else:
                expected_momentum = "accelerating"
        elif reflection_state.emotional_direction == "settling":
            expected_momentum = "decelerating"
            
        # --- 4. Expected Identity Pressure ---
        expected_id_pressure = "stable"
        if monitoring_state.identity_stability < 0.4 and reflection_state.coherence in ["Conflicted", "Fragmented"]:
            expected_id_pressure = "building"
        elif monitoring_state.identity_stability > 0.8 and reflection_state.coherence in ["Stable", "Converging"]:
            expected_id_pressure = "releasing"
            
        # --- 5. Expected Curiosity ---
        expected_curiosity = "stable"
        if monitoring_state.cognitive_fatigue > 0.7:
            expected_curiosity = "collapsing"
        elif self_state.curiosity > 0.6 and monitoring_state.identity_stability > 0.6:
            expected_curiosity = "expanding"
            
        # --- 6. Expected Open Loop Re-emergence ---
        expected_open_loop = None
        if reflection_state.recurrence_strength > 0.6:
            if awareness_history.frames:
                expected_open_loop = awareness_history.frames[-1].dominant_theme
                
        # --- 7. Prediction Confidence & Stability ---
        prediction_confidence = monitoring_state.monitor_confidence * (1.0 - monitoring_state.oscillation_index)
        
        # Build temp prediction to check stability
        temp_prediction = PredictionState(
            expected_attention=expected_attention,
            expected_reflection=expected_reflection,
            expected_emotional_momentum=expected_momentum,
            expected_identity_pressure=expected_id_pressure,
            expected_curiosity=expected_curiosity,
            expected_open_loop_return=expected_open_loop,
            prediction_confidence=prediction_confidence,
            prediction_stability=1.0 # Temporary
        )
        
        prediction_stability = self.history.get_stability(temp_prediction)
        
        # Build final Prediction
        prediction = PredictionState(
            expected_attention=expected_attention,
            expected_reflection=expected_reflection,
            expected_emotional_momentum=expected_momentum,
            expected_identity_pressure=expected_id_pressure,
            expected_curiosity=expected_curiosity,
            expected_open_loop_return=expected_open_loop,
            prediction_confidence=prediction_confidence,
            prediction_stability=prediction_stability
        )
        
        self.history.append(prediction)
        return prediction
