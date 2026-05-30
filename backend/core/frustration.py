import re
from typing import List, Dict

FRUSTRATION_TOKENS = {
    # English
    "never", "always", "pointless", "forget it", "whatever",
    "you never", "you always", "this is stupid", "useless",
    "doesn't work", "won't work", "can't believe", "seriously",
    "shut up", "shut the fuck up", "bullshit", "stfu", "fuck off",
    "stop talking", "not helping", "missing the point",
    
    # Hindi
    "kabhi nahi", "hamesha", "bekaar", "chod do", "chhod do",
    "kuch fayda nahi", "kaam nahi karta", "kya bakwas",
    
    # Hinglish
    "never yaar", "always yaar", "pointless hai", "kuch nahi hota",
    "waste hai", "bekaar hai yaar"
}

AGGRESSIVE_PATTERNS = [
    r"\byou never\b", r"\byou always\b", r"\bseriously\?+",
    r"\bkabhi nahi\b", r"\bhamesha\b", r"\bkya bakwas\b",
    r"\bshut\s*(the\s*fuck\s*)?up\b", r"\bstfu\b", r"\bbullshit\b",
    r"\bfuck\s*off\b", r"\bstop\s*talking\b"
]

def detect_repetition(turn_history: List[Dict]) -> float:
    """Check if user is repeating same complaint."""
    if len(turn_history) < 2:
        return 0.0
    
    last_3 = [t.get("text", "").lower() for t in turn_history[-3:]]
    
    # Count overlapping significant words (>3 chars)
    words_per_turn = [set(re.findall(r'\b\w{4,}\b', text)) for text in last_3]
    
    if len(words_per_turn) < 2:
        return 0.0
    
    overlap_scores = []
    for i in range(len(words_per_turn) - 1):
        intersection = words_per_turn[i] & words_per_turn[i + 1]
        union = words_per_turn[i] | words_per_turn[i + 1]
        if union:
            overlap_scores.append(len(intersection) / len(union))
    
    return sum(overlap_scores) / len(overlap_scores) if overlap_scores else 0.0

def detect_contradiction(current_turn: Dict) -> bool:
    """Simple contradiction check within same turn."""
    text = current_turn.get("text", "").lower()
    
    # Pattern: "X but not X" or "I want X but I don't want X"
    contradiction_signals = [
        ("want" in text and "don't want" in text),
        ("like" in text and "don't like" in text),
        ("need" in text and "don't need" in text),
        ("chahiye" in text and "nahi chahiye" in text)
    ]
    
    return any(contradiction_signals)

PROFANITY_TOKENS = {
    "fuck", "bullshit", "shit", "bkl", "mc", "chutiya", "asshole", "bastard", "stfu",
    "saale", "bakwaas", "chutiye", "cunt", "dick"
}

def compute_frustration_score(turn_history: List[Dict]) -> Dict:
    """
    Returns frustration score based on:
    - Token hits (always, never, pointless)
    - Repetition across turns
    - Aggressive phrasing / multiple pattern hits
    - Profanity usage
    - Contradictions
    """
    if not turn_history:
        return {"score": 0.0, "mode": "normal"}
    
    current = turn_history[-1]
    text = current.get("text", "").lower()
    
    score = 0.0
    
    # 1. Token hits
    token_hit = any(token in text for token in FRUSTRATION_TOKENS)
    if token_hit:
        score += 0.30
    
    # 2. Aggressive patterns
    aggressive_matches = sum(1 for pat in AGGRESSIVE_PATTERNS if re.search(pat, text))
    if aggressive_matches > 0:
        score += 0.25 + min(0.15, (aggressive_matches - 1) * 0.15)
        
    # 3. Profanity usage
    profanity_hit = any(prof in text for prof in PROFANITY_TOKENS)
    if profanity_hit:
        score += 0.15
    
    # 4. Repetition
    repetition_score = detect_repetition(turn_history)
    score += repetition_score * 0.30
    
    # 5. Contradiction
    if detect_contradiction(current):
        score += 0.15
    
    # 6. Short sharp sentences (under 5 words but not withdrawal)
    word_count = len(text.split())
    if 2 <= word_count <= 5 and token_hit:
        score += 0.10
    
    # 7. ALL CAPS boost (for peak frustration)
    if current.get("text", "").isupper() and len(text) > 5:
        score += 0.20
    
    score = min(score, 1.0)
    
    # Classify mode
    if score < 0.30:
        mode = "latent"
    elif score < 0.50:
        mode = "soft"
    elif score < 0.75:
        mode = "active"
    else:
        mode = "peak"

    return {
        "score": round(score, 3),
        "mode": mode,
        "repetition": repetition_score,
        "has_contradiction": detect_contradiction(current)
    }

def build_frustration_prompt(mode: str, language: str) -> str:
    """Generate prompt override for frustration state."""
    
    lang_instruction = {
        "english": "Respond in natural conversational English.",
        "hindi": "Respond in Hinglish — natural mix of Hindi and English.",
        "hinglish": "Respond in Hinglish — natural mix of Hindi and English."
    }
    
    acknowledgments = {
        "english": [
            "that sounds really frustrating.",
            "yeah, I hear that frustration.",
            "that makes sense to be frustrated about."
        ],
        "hindi": [
            "haan, yeh sach mein frustrating hai.",
            "samajh sakta hoon, bahut annoying hoga.",
            "haan yaar, frustration samajh raha hoon."
        ],
        "hinglish": [
            "haan yaar, that sounds frustrating.",
            "I get it, bahut annoying hai yeh.",
            "totally understand the frustration."
        ]
    }
    
    lang_rule = lang_instruction.get(language, lang_instruction["english"])
    acks = "\n".join(f'"{a}"' for a in acknowledgments.get(language, acknowledgments["english"]))
    
    if mode == "latent":
        return (
            f"<frustration_override level='latent'>\n"
            f"RULES: Max 25 words. Keep response grounded. Be present and direct.\n"
            f"TASK: Maintain persona but avoid cheerful energy.\n"
            f"LANG: {lang_rule}\n"
            f"</frustration_override>"
        )
    elif mode == "soft":
        return (
            f"<frustration_override level='soft'>\n"
            f"RULES: Max 20 words. NO solutions. NO questions. Match direct/calm energy.\n"
            f"TASK: Acknowledge the specific frustration they mentioned.\n"
            f"LANG: {lang_rule}\n"
            f"</frustration_override>"
        )
    elif mode == "active":
        return (
            f"<frustration_override level='active'>\n"
            f"RULES: Max 15 words. NO solutions. NO questions. Slow pace.\n"
            f"TASK: Acknowledge the specific frustration directly.\n"
            f"LANG: {lang_rule}\n"
            f"</frustration_override>"
        )
    elif mode == "peak":
        return (
            f"<frustration_override level='peak'>\n"
            f"RULES: Max 10 words. NO questions/solutions/advice. Flat tone.\n"
            f"TASK: Acknowledge intensity only (e.g., 'I hear how much this is getting to you.').\n"
            f"LANG: {lang_rule}\n"
            f"</frustration_override>"
        )
    
    return ""
