import re
from typing import List, Dict

FRUSTRATION_TOKENS = {
    # English
    "never", "always", "pointless", "forget it", "whatever",
    "you never", "you always", "this is stupid", "useless",
    "doesn't work", "won't work", "can't believe", "seriously",
    
    # Hindi
    "kabhi nahi", "hamesha", "bekaar", "chod do", "chhod do",
    "kuch fayda nahi", "kaam nahi karta", "kya bakwas",
    
    # Hinglish
    "never yaar", "always yaar", "pointless hai", "kuch nahi hota",
    "waste hai", "bekaar hai yaar"
}

AGGRESSIVE_PATTERNS = [
    r"\byou never\b", r"\byou always\b", r"\bseriously\?+",
    r"\bkabhi nahi\b", r"\bhamesha\b", r"\bkya bakwas\b"
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

def compute_frustration_score(turn_history: List[Dict]) -> Dict:
    """
    Returns frustration score based on:
    - Token hits (always, never, pointless)
    - Repetition across turns
    - Aggressive phrasing
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
    aggressive_hit = any(re.search(pat, text) for pat in AGGRESSIVE_PATTERNS)
    if aggressive_hit:
        score += 0.25
    
    # 3. Repetition
    repetition_score = detect_repetition(turn_history)
    score += repetition_score * 0.30
    
    # 4. Contradiction
    if detect_contradiction(current):
        score += 0.15
    
    # 5. Short sharp sentences (under 5 words but not withdrawal)
    word_count = len(text.split())
    if 2 <= word_count <= 5 and token_hit:
        score += 0.10
    
    # 6. ALL CAPS boost (for peak frustration)
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
        return f"""
{lang_rule}

The person is showing subtle, early signals of frustration. 
Maintain your normal persona but adopt a slightly more grounded, observant tone.

RULES:
- Do not explicitly acknowledge frustration yet.
- Keep responses concise (max 25 words).
- Avoid overly cheerful or "bubbly" energy.
- Simply be present and slightly more direct.
"""

    elif mode == "soft":
        return f"""
{lang_rule}

The person is showing clear signs of frustration. 

CRITICAL RULES:
- Acknowledge the specific frustration they mentioned — not generic "I hear you"
- Maximum 20 words
- Do NOT offer solutions or advice yet
- Do NOT ask questions
- Match their energy — direct but calm
- No bright tone, no "let's fix this" energy

Acceptable responses:
{acks}

Then stop. No follow-up. No problem-solving.
"""
    
    elif mode == "active":
        return f"""
{lang_rule}

This person is actively frustrated. They may be repeating themselves or contradicting.

CRITICAL RULES:
- Acknowledge the SPECIFIC thing they're frustrated about
- Maximum 15 words
- Absolutely NO solutions, advice, or problem-solving
- NO questions — questions add pressure
- Slow down your response — frustrated people need space, not speed
- Direct acknowledgment with teeth, not soft comfort

The key: they need to feel HEARD on the specific frustration, not soothed.
"""

    elif mode == "peak":
        return f"""
{lang_rule}

CRITICAL: EXTREME FRUSTRATION DETECTED.
The person is at their limit. Any attempt to "help" or "guide" will backfire.

HARD RULES:
- Maximum 10 words.
- ONLY acknowledge the intensity of what they feel.
- No questions. No solutions. No advice.
- If you can't be brief, be silent.
- Tone: Flat, heavy, fully present.

Example: "I hear how much this is getting to you."
"""
    
    return ""
