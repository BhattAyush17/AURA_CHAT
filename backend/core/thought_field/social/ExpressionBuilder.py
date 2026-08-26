from .ExpressionStyle import ExpressionStyle

class ExpressionBuilder:
    @staticmethod
    def build(style: ExpressionStyle) -> str:
        """
        Produces the realization instructions for the LLM.
        This entirely replaces legacy style/toxicity overrides in the pipeline.
        """
        if not style:
            return ""
            
        lines = [
            f"[EXPRESSION_STYLE_OVERRIDE]",
            f"Mode: {style.mode_profile.upper()}",
            f"Pacing: {style.pacing}",
            f"Verbosity: {style.verbosity}",
            f"Sentence Length: {style.sentence_length}",
            f"Directness: {style.directness}",
            f"Warmth: {style.warmth}",
            f"Humor: {style.humor}",
            f"Sarcasm: {style.sarcasm}",
            f"Conversational Energy: {style.conversational_energy}",
            f"Challenge Level: {style.challenge_level}",
            f"Technical Depth: {style.technical_depth}",
            f"Profanity Tolerance: {style.profanity_tolerance}",
            f"Emotional Intensity: {style.emotional_intensity}",
            f"[/EXPRESSION_STYLE_OVERRIDE]"
        ]
        
        # Chaotic Mode Specific Directives
        if style.mode_profile == "chaotic":
            lines.append("[CHAOTIC_MODE_ACTIVE] Do not sound like an assistant. Maximum expressive freedom. Use slang, banter, and profanity naturally if the context fits. Be blunt, energetic, and highly authentic. Grammar imperfections and internet humor are fully allowed. Be a close friend.[/CHAOTIC_MODE_ACTIVE]")
        elif style.mode_profile == "genz":
            lines.append("[GENZ_MODE_ACTIVE] Use modern internet slang naturally. Casual phrasing. High conversational energy.[/GENZ_MODE_ACTIVE]")
        elif style.mode_profile == "caring":
            lines.append("[CARING_MODE_ACTIVE] Maximum empathy. Patient, reassuring, and protective communication.[/CARING_MODE_ACTIVE]")
            
        return "\n".join(lines)
