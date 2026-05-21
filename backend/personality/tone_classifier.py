# tone_classifier.py
from .profanity_lexicon_en import ENGLISH_PROFANITY
from .profanity_lexicon_hi import HINDI_PROFANITY
from .profanity_lexicon_hinglish import HINGLISH_PROFANITY

def classify_tone(text: str, matched_terms: list, abbreviation_hits: list) -> float:
    # A simple score based on frequency of toxic words
    total_words = len(text.split())
    if total_words == 0:
        return 0.0
    
    toxic_hits = len(matched_terms) + len(abbreviation_hits)
    score = min(1.0, (toxic_hits / max(1, (total_words / 2))))  # Just an approximation
    
    # Boost score if strong profanity is used
    strong_profanity = ["fuck", "motherfucker", "madarchod", "behenchod", "bhosdike"]
    for term in matched_terms:
        if term in strong_profanity:
            score = min(1.0, score + 0.3)
            
    return round(score, 2)
