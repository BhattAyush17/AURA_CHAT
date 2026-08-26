class CognitiveSnapshotBuilder:
    @staticmethod
    def build(window, presence, self_state, expression_style=None):
        """
        The only layer that communicates with the frontend.
        Internal cognition is completely hidden. Only conscious outcomes are exposed.
        """
        lines = []
        
        lines.append(f"Awareness Summary: {window.awareness_summary}")
        lines.append(f"Attention Direction: {window.attention_direction}")
        
        if window.conscious_thoughts:
            lines.append("Current Focus:")
            for thought in window.conscious_thoughts:
                lines.append(f"  - {thought}")
                
        if window.emerging_insight:
            lines.append(f"Emerging Insight: {window.emerging_insight}")
            
        # Conscious emotional state
        lines.append(f"Comfort Level: {self_state.comfort:.2f}")
        lines.append(f"Thinking Depth: {self_state.reflection_depth:.2f}")
        
        # High-level presence bias, stripping internal pressures
        bias = presence.get_bias_string()
        if bias:
            lines.append(f"Emotional Momentum: {bias}")
            
        if expression_style:
            lines.append("")
            lines.append(expression_style.to_prompt_injection())
            
        return "\n".join(lines)
