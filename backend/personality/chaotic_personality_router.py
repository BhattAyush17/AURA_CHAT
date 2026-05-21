# chaotic_personality_router.py

def route_chaotic_personality(intent: str, toxicity_score: float) -> dict:
    if toxicity_score > 0.8:
        response_style = "aggressive_chaotic_banter"
        sarcasm_level = "high"
    elif intent in ["playful_roasting", "joking"]:
        response_style = "sarcastic_roast"
        sarcasm_level = "extreme"
    elif intent == "emotional_venting":
        response_style = "unpredictable_empathy"
        sarcasm_level = "low"
    else:
        response_style = "dynamic_multilingual"
        sarcasm_level = "medium"
        
    return {
        "personality_mode": "chaotic",
        "response_style": response_style,
        "sarcasm_level": sarcasm_level,
        "rhythm": "unpredictable_human_like"
    }
