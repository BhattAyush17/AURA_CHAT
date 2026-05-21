# toxicity_engine.py
from .speech_noise_cleaner import clean_speech_noise
from .transliteration_normalizer import normalize_transliteration
from .abbreviation_mapper import map_abbreviations
from .fuzzy_matcher import fuzzy_match_profanity
from .session_slang_memory import SessionSlangMemory
from .tone_classifier import classify_tone
from .intent_resolver import resolve_intent
from .adaptive_style_engine import generate_adaptive_style
from .chaotic_personality_router import route_chaotic_personality
import re

session_memory = SessionSlangMemory()

def process_toxicity_pipeline(text: str, session_id: str = "default", mode: str = "adaptive") -> dict:
    # 1. Speech Noise Cleanup
    cleaned_text = clean_speech_noise(text)
    
    # 2. Transliteration Normalization
    normalized_text = normalize_transliteration(cleaned_text)
    
    # 3. Abbreviation Mapper
    expanded_text, abbreviation_hits = map_abbreviations(normalized_text)
    
    # 4. Fuzzy Matcher
    matched_terms = fuzzy_match_profanity(expanded_text)
    
    # 5. Exact match on raw words for profanity not caught by fuzzy
    from .fuzzy_matcher import ALL_PROFANITY
    exact_matches = [w for w in expanded_text.split() if w in ALL_PROFANITY and w not in matched_terms]
    matched_terms.extend(exact_matches)
    
    # 6. Session Slang Memory
    session_memory.track_slang(session_id, matched_terms, abbreviation_hits)
    slang_profile = session_memory.get_session_profile(session_id)
    
    # 7. Tone Classifier
    toxicity_score = classify_tone(expanded_text, matched_terms, abbreviation_hits)
    toxicity_detected = toxicity_score > 0.0
    
    # Language detection (Simplified)
    lang = "english"
    if any(re.search(r'[\u0900-\u097F]', c) for c in text):
        lang = "hindi"
    elif any(w in expanded_text.split() for w in ["hai", "kya", "bhai", "nahi", "bc", "mc"]):
        lang = "hinglish"
    
    # 8. Intent Resolver
    intent = resolve_intent(expanded_text, toxicity_score, matched_terms)
    
    # 9 & 10. Adaptive & Chaotic Routing
    if mode == "chaotic":
        routing_info = route_chaotic_personality(intent, toxicity_score)
        adaptive_info = {}
    else:
        routing_info = {"personality_mode": "adaptive", "response_style": "dynamic_mirroring"}
        adaptive_info = generate_adaptive_style(toxicity_score, intent, slang_profile)
    
    return {
        "toxicity_detected": toxicity_detected,
        "language": lang,
        "toxicity_score": toxicity_score,
        "matched_terms": matched_terms,
        "abbreviation_hits": abbreviation_hits,
        "normalized_forms": expanded_text.split(),
        "user_custom_slang": slang_profile.get("observed_user_slang", []),
        "intent": intent,
        "personality_mode": routing_info.get("personality_mode"),
        "adaptive_mirroring": adaptive_info.get("adaptive_mirroring", False) if mode == "adaptive" else True,
        "response_style": routing_info.get("response_style")
    }
