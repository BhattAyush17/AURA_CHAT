from .profanity_lexicon_en import ENGLISH_PROFANITY
from .profanity_lexicon_hi import HINDI_PROFANITY
from .profanity_lexicon_hinglish import HINGLISH_PROFANITY

# Pre-compile the profanity list into an O(1) lookup set during server boot.
ALL_PROFANITY_SET = frozenset(ENGLISH_PROFANITY + HINDI_PROFANITY + HINGLISH_PROFANITY)
ALL_PROFANITY = ALL_PROFANITY_SET  # Alias for backward compatibility

def fast_match_profanity(text: str) -> list:
    """
    O(N) exact matching. Extremely fast, non-blocking.
    Relies on transliteration_normalizer to handle variations.
    """
    words = set(text.lower().split())
    # O(1) intersection
    matched_terms = list(words.intersection(ALL_PROFANITY_SET))
    return matched_terms

# Alias for backward compatibility
fuzzy_match_profanity = fast_match_profanity
