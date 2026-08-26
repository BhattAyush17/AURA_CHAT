from typing import List
from .MonitoringState import MonitoringState
from .FeedbackState import FeedbackState
from .FeedbackRule import FeedbackRule

class IntrospectiveFeedback:
    def __init__(self):
        self.rules: List[FeedbackRule] = [
            FeedbackRule(
                name="Fatigue Recovery",
                target_parameter="mental_energy",
                evaluate=lambda m: 0.005 if m.cognitive_fatigue > 0.6 else (-0.002 if m.cognitive_fatigue < 0.2 else 0.0)
            ),
            FeedbackRule(
                name="Oscillation Calming",
                target_parameter="comfort",
                evaluate=lambda m: -0.005 if m.oscillation_index > 0.5 else 0.002
            ),
            FeedbackRule(
                name="Stability Confidence",
                target_parameter="comfort", # We adjust comfort as a proxy for long-term internal certainty
                evaluate=lambda m: 0.004 if m.identity_stability > 0.8 and m.reflection_persistence > 0.7 else 0.0
            ),
            FeedbackRule(
                name="Reflection Overload",
                target_parameter="reflection_depth",
                evaluate=lambda m: -0.005 if m.cognitive_fatigue > 0.7 and m.attention_drift > 0.6 else 0.0
            ),
            FeedbackRule(
                name="Curiosity Exhaustion",
                target_parameter="curiosity",
                evaluate=lambda m: -0.004 if m.cognitive_fatigue > 0.8 else (0.002 if m.curiosity_trend > 0.5 else 0.0)
            )
        ]
        
    def regulate(self, monitoring_state: MonitoringState, self_state) -> FeedbackState:
        """
        Biological homeostasis layer.
        Performs microscopic, clamped adjustments to SelfState based on long-term MonitoringState.
        """
        adjustments = {}
        total_strength = 0.0
        
        # Guard: If monitoring confidence is extremely low, we shouldn't regulate strongly
        confidence_multiplier = monitoring_state.monitor_confidence
        
        for rule in self.rules:
            # 1. Evaluate Rule
            raw_adjustment = rule.evaluate(monitoring_state)
            
            # 2. Apply Confidence
            adjusted = raw_adjustment * confidence_multiplier
            
            # 3. Absolute Hard Clamp (Max 0.01 per execution)
            clamped = max(-0.01, min(0.01, adjusted))
            
            if abs(clamped) > 0.0001:
                adjustments[rule.target_parameter] = clamped
                total_strength += abs(clamped)
                
                # 4. Apply to SelfState (Homeostatic bounding)
                current_val = getattr(self_state, rule.target_parameter, 0.5)
                new_val = max(0.1, min(0.9, current_val + clamped)) # Never maximize or minimize entirely
                setattr(self_state, rule.target_parameter, new_val)
                
        # Determine direction
        direction = "neutral"
        if total_strength > 0.001:
            if adjustments.get("comfort", 0.0) > 0 or adjustments.get("mental_energy", 0.0) > 0:
                direction = "stabilizing"
            elif adjustments.get("reflection_depth", 0.0) < 0:
                direction = "calming"
            elif adjustments.get("curiosity", 0.0) > 0:
                direction = "energizing"
                
        # Build FeedbackState (Pure structure, no recursion)
        return FeedbackState(
            feedback_strength=total_strength,
            feedback_direction=direction,
            regulated_parameters=adjustments,
            stability=1.0 - monitoring_state.oscillation_index,
            confidence=monitoring_state.monitor_confidence
        )
