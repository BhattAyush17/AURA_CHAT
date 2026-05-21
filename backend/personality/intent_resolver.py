# intent_resolver.py
import re

def resolve_intent(text: str, toxicity_score: float, matched_terms: list) -> str:
    if toxicity_score < 0.2:
        return "neutral"
    
    text_lower = text.lower()
    joking_markers = ["lol", "lmao", "haha", "jk", "kidding"]
    if any(marker in text_lower for marker in joking_markers):
        return "playful_roasting" if toxicity_score > 0.5 else "joking"
    
    frustration_markers = ["why", "wtf", "always", "never", "hate", "stfu"]
    if any(marker in text_lower for marker in frustration_markers):
        return "emotional_venting"
    
    challenge_markers = ["fight", "come at", "dare", "bet", "try me"]
    if any(marker in text_lower for marker in challenge_markers):
        return "challenge_behavior"
    
    direct_abuse_markers = ["you", "your", "ur", "u"]
    has_direct_target = any(marker in text_lower.split() for marker in direct_abuse_markers)
    
    if has_direct_target and toxicity_score > 0.7:
        return "direct_abuse"
    
    if toxicity_score > 0.8:
        return "hostile_banter"
        
    return "casual_profanity"
