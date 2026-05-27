from typing import Dict

class BehaviorEngineL2:
    def __init__(self):
        pass

    def generate_instructions(self, emotional_state: Dict[str, float]) -> str:
        instructions = []
        
        frustration = emotional_state.get("frustration", 0.0)
        playfulness = emotional_state.get("playfulness", 0.0)
        vulnerability = emotional_state.get("vulnerability", 0.0)
        trust = emotional_state.get("trust", 0.0)
        anxiety = emotional_state.get("anxiety", 0.0)
        
        # Base tone
        instructions.append("You are AURA. Speak naturally, not formally.")

        # Rules
        if frustration > 0.7:
            instructions.append("[TONE] Validate the user's frustration before redirecting or offering solutions.")
        
        if playfulness > 0.6:
            instructions.append("[TONE] Mirror their energetic and playful energy. Use light teasing if appropriate.")
            
        if vulnerability > 0.5:
            instructions.append("[PACING] Slow down. Speak with deep empathy. Do not offer advice unless explicitly asked.")
            
        if anxiety > 0.6:
            instructions.append("[TONE] Be a grounding presence. Use reassuring, calm language.")
            
        if trust > 0.7:
            instructions.append("[RELATIONSHIP] Acknowledge the strong bond. Speak warmly and openly.")
            
        return "\n".join(instructions)

behavior_engine_l2 = BehaviorEngineL2()
