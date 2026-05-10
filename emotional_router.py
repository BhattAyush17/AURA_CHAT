from withdrawal_detector import compute_withdrawal_score, detect_language, build_withdrawal_prompt
from frustration_detector import compute_frustration_score, build_frustration_prompt

class EmotionalStateRouter:
    """
    Runs all emotion detectors each turn and picks the dominant state.
    Priority order: vulnerability > frustration > flooding > withdrawal > testing
    """
    
    # Add states as you build their detectors
    PRIORITY = ["frustration", "withdrawal"]
    
    def __init__(self):
        self.scores = {s: 0.0 for s in self.PRIORITY}
        self.active_state = "normal"
        self.language = "english"
        self.intensity = 0.0
        self.consecutive_low_turns = 0
        self.consecutive_boost_turns = 0
        self.boost_active = False
    
    def resolve(self, turn_history: list, current_turn: dict) -> dict:
        """
        Run all detectors, pick dominant state, return routing decision.
        """
        
        # RUN all active detectors
        withdrawal_result = compute_withdrawal_score(turn_history + [current_turn])
        frustration_result = compute_frustration_score(turn_history + [current_turn])
        
        self.scores["withdrawal"] = withdrawal_result["score"]
        self.scores["frustration"] = frustration_result["score"]
        
        # Track consecutive low energy for Companion Boost
        if withdrawal_result["score"] >= 0.4:
            self.consecutive_low_turns += 1
        else:
            self.consecutive_low_turns = 0
            self.boost_active = False
            self.consecutive_boost_turns = 0
        
        # DETECT language
        self.language = detect_language(current_turn.get("text", ""))
        
        # PICK dominant state by priority (first above 0.4 threshold wins)
        dominant = "normal"
        intensity = 0.0
        
        for state in self.PRIORITY:
            if self.scores.get(state, 0.0) >= 0.3:
                dominant = state
                intensity = self.scores[state]
                break
        
        self.active_state = dominant
        self.intensity = intensity
        
        # BUILD prompt override
        override = self._build_override(dominant, intensity, self.language)
        
        display_state = "companion_boost" if self.boost_active else dominant
        
        return {
            "state": display_state,
            "intensity": intensity,
            "language": self.language,
            "prompt_override": override,
            "all_scores": self.scores.copy()
        }
    
    def _build_override(self, state: str, intensity: float, language: str) -> str:
        """Route to the correct prompt builder based on state."""
        
        if self.consecutive_low_turns >= 5:
            self.boost_active = True
            self.consecutive_boost_turns += 1
            if self.consecutive_boost_turns > 2:
                # Reset after 2 boost turns
                self.consecutive_low_turns = 0
                self.boost_active = False
                self.consecutive_boost_turns = 0
            else:
                return build_withdrawal_prompt("companion_boost", language)

        if state == "normal":
            return ""
        
        # Standard Intensity Mapping
        if intensity < 0.3:
            mode = "latent"
        elif intensity < 0.5:
            mode = "soft"
        elif intensity < 0.75:
            mode = "active"
        else:
            mode = "peak"
        
        if state == "withdrawal":
            return build_withdrawal_prompt(mode, language, exit_turn=0)
        
        elif state == "frustration":
            return build_frustration_prompt(mode, language)
        
        return ""
