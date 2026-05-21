# fuzzy_matcher.py
import difflib
from .profanity_lexicon_en import ENGLISH_PROFANITY
from .profanity_lexicon_hi import HINDI_PROFANITY
from .profanity_lexicon_hinglish import HINGLISH_PROFANITY

ALL_PROFANITY = ENGLISH_PROFANITY + HINDI_PROFANITY + HINGLISH_PROFANITY

def fuzzy_match_profanity(text: str, threshold: float = 0.8) -> list:
    words = text.split()
    matched_terms = []
    for word in words:
        if len(word) < 3:
            continue
        matches = difflib.get_close_matches(word, ALL_PROFANITY, n=1, cutoff=threshold)
        if matches:
            matched_terms.append(matches[0])
    return list(set(matched_terms))
