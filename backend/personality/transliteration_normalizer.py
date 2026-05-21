# transliteration_normalizer.py
import re

def normalize_transliteration(text: str) -> str:
    # Lowercase
    text = text.lower()
    # Remove excessive repeated characters (e.g., "bccc" -> "bc", "fuuuuck" -> "fuck")
    text = re.sub(r'(.)\1{2,}', r'\1\1', text)
    # Strip unnecessary punctuation
    text = re.sub(r'[!?,.]+', ' ', text)
    # Common replacements for slang spelling
    text = re.sub(r'\bvro\b', 'bro', text)
    text = re.sub(r'\bboi\b', 'boy', text)
    # Normalize spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text
