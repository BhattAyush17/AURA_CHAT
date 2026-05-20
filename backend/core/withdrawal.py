import re
import json
import time
from typing import Optional, Dict, Any, List

STOPWORDS = {
    # English
    "i", "me", "my", "the", "a", "an", "is", "it", "in", "on", "at", "to",
    "do", "be", "of", "and", "or", "but", "so", "if", "as", "by", "we",
    # Hindi romanized
    "mai", "mujhe", "mera", "meri", "yeh", "woh", "hai", "hain", "ka",
    "ki", "ke", "se", "ko", "ne", "par", "aur", "ya", "toh", "bhi",
    # Hinglish connectors
    "matlab", "toh", "na", "nahi", "haan", "bas", "kuch", "sab", "ek"
}

WITHDRAWAL_TOKENS = {
    # English
    "yeah", "ok", "okay", "fine", "idk", "whatever", "sure", "hmm",
    "i guess", "dunno", "nothing", "nope", "yep", "meh", "oh", "right",
    # Hindi
    "haan", "theek", "theek hai", "pata nahi", "kuch nahi", "chodo",
    "chhodo", "bas", "hmm", "achha", "acha", "haa", "nahi", "na",
    # Hinglish
    "haan okay", "theek hai yaar", "pata nahi yaar", "chhod na",
    "kuch nahi yaar", "bas yaar", "whatever yaar", "idk yaar",
    "haan fine", "okay fine", "chalega", "chal", "dekho", "dekh"
}

def detect_language(text: str) -> str:
    hindi_markers = ["hai", "hain", "nahi", "kya", "yeh", "woh", "mera",
                     "tera", "haan", "theek", "acha", "yaar", "bhai",
                     "kal", "aaj", "kab", "kyun", "kaise", "kaun"]
    words = text.lower().split()
    hindi_count = sum(1 for w in words if w in hindi_markers)
    ratio = hindi_count / max(len(words), 1)
    if ratio > 0.4:
        return "hindi"
    elif ratio > 0.15:
        return "hinglish"
    return "english"

def get_semantic_density(text: str) -> float:
    words = re.findall(r'\b\w+\b', text.lower())
    if not words:
        return 0.0
    content_words = [w for w in words if w not in STOPWORDS]
    return len(content_words) / len(words)

def get_withdrawal_token_hit(text: str) -> bool:
    text_lower = text.lower().strip()
    return any(token in text_lower for token in WITHDRAWAL_TOKENS)

def compute_withdrawal_score(turn_history: list) -> dict:
    if not turn_history:
        return {"score": 0.0, "consecutive_low_turns": 0, "language": "english", "mode": "normal", "last_word_counts": []}

    last_3 = turn_history[-3:]
    scores = []

    for turn in last_3:
        text = turn.get("text", "")
        words = text.split()
        word_count = len(words)
        density = get_semantic_density(text)
        token_hit = get_withdrawal_token_hit(text)
        initiated = turn.get("user_initiated", False)

        turn_score = 0.0
        if word_count <= 2:   turn_score += 0.40
        elif word_count <= 5: turn_score += 0.25
        elif word_count <= 8: turn_score += 0.10

        if density < 0.2:     turn_score += 0.25
        elif density < 0.4:   turn_score += 0.10

        if token_hit:         turn_score += 0.20
        if not initiated:     turn_score += 0.10
        if text.strip().endswith(("...", "—")):
                              turn_score += 0.05

        scores.append(min(turn_score, 1.0))

    # weight recent turns more heavily
    weights = [0.2, 0.35, 0.45] if len(scores) == 3 else [0.4, 0.6] if len(scores) == 2 else [1.0]
    final_score = sum(s * w for s, w in zip(scores[-len(weights):], weights))
    consecutive = sum(1 for s in scores if s > 0.4)

    return {
        "score": round(final_score, 3),
        "consecutive_low_turns": consecutive,
        "last_word_counts": [len(t.get("text","").split()) for t in last_3],
        "language": detect_language(last_3[-1].get("text", "")),
        "mode": classify_withdrawal_mode(final_score)
    }

def classify_withdrawal_mode(score: float) -> str:
    if score < 0.30:  return "latent"
    if score < 0.50:  return "soft"
    if score < 0.75:  return "active"
    return "peak"

def detect_exit(turn_history: list, current_turn: dict) -> dict:
    signals = []
    current_text = current_turn.get("text", "")
    current_words = len(current_text.split())

    if len(turn_history) >= 2:
        prev_counts = [len(t.get("text","").split()) for t in turn_history[-2:]]
        if current_words > prev_counts[-1] and current_words > prev_counts[-2]:
            signals.append("word_count_rising")

    if current_turn.get("user_initiated", False):
        signals.append("user_initiated")

    if "?" in current_text:
        signals.append("question_asked")

    flat_tokens = set(WITHDRAWAL_TOKENS)
    current_set = set(current_text.lower().split())
    if len(current_set - flat_tokens) > 3:
        signals.append("affect_returning")

    signal_count = len(signals)
    if signal_count == 0:   action = "stay"
    elif signal_count <= 1: action = "stay"
    elif signal_count == 2: action = "ease"
    else:                   action = "return"

    return {
        "exit_signal_strength": round(signal_count / 4, 2),
        "signals_detected": signals,
        "recommended_action": action
    }

class WithdrawalStateManager:
    def __init__(self):
        self.reset()

    def reset(self):
        self.score = 0.0
        self.consecutive_low_turns = 0
        self.mode = "latent"
        self.exit_turn_count = 0
        self.exiting = False
        self.language = "english"
        self.consecutive_boost_turns = 0 # Track how long we've been in boost mode
        self.boost_active = False

    def update(self, turn_history: list, current_turn: dict):
        result = compute_withdrawal_score(turn_history + [current_turn])
        self.score = result["score"]
        self.consecutive_low_turns = result["consecutive_low_turns"]
        self.language = result["language"]

        if self.exiting:
            self.exit_turn_count += 1
            if self.exit_turn_count >= 3:
                self.reset()
            return

        exit_result = detect_exit(turn_history, current_turn)
        if exit_result["recommended_action"] == "return":
            self.exiting = True
            self.exit_turn_count = 0
            self.mode = "exiting"
            self.boost_active = False
            self.consecutive_boost_turns = 0
        elif exit_result["recommended_action"] == "ease":
            self.mode = "ease"
            self.boost_active = False
            self.consecutive_boost_turns = 0
        elif self.consecutive_low_turns >= 5:
            # TRIGGER COMPANION BOOST: Break the pattern of silence
            self.mode = "companion_boost"
            self.boost_active = True
            self.consecutive_boost_turns += 1
            if self.consecutive_boost_turns > 2: # Stop boost after 2 turns to avoid being annoying
                self.consecutive_low_turns = 0 # Force a reset
                self.boost_active = False
                self.consecutive_boost_turns = 0
        else:
            self.mode = result["mode"]
            self.boost_active = False
            self.consecutive_boost_turns = 0

    def get_prompt_override(self) -> str:
        return build_withdrawal_prompt(self.mode, self.language, self.exit_turn_count)

def build_withdrawal_prompt(mode: str, language: str, exit_turn: int = 0) -> str:
    lang_presence = {
        "english":  ["I'm here.", "yeah... no rush.", "mm.", "take your time.", "I'm not going anywhere."],
        "hindi":    ["main yahan hoon.", "haan... koi jaldi nahi.", "hmm.", "apna waqt lo.", "main kahin nahi ja raha."],
        "hinglish": ["main yahan hoon yaar.", "haan... no rush.", "hmm.", "apna time lo.", "main yahan hoon, kahin nahi ja raha."]
    }

    lang_instruction = {
        "english":  "Respond in natural conversational English.",
        "hindi":    "Hinglish mein jawab do — roman script mein, natural aur warm.",
        "hinglish": "Respond in Hinglish — mix Hindi and English naturally as a friend would speak."
    }

    safe_fallback = {
        "english":  "I'm here.",
        "hindi":    "main yahan hoon.",
        "hinglish": "main yahan hoon yaar."
    }

    presence_options = "\n".join(f'"{p}"' for p in lang_presence.get(language, lang_presence["english"]))
    fallback = safe_fallback.get(language, safe_fallback["english"])
    lang_rule = lang_instruction.get(language, lang_instruction["english"])

    if mode == "latent":
        return f"""
{lang_rule}

The person is becoming slightly quieter or more guarded. 
Maintain presence without applying any conversational pressure.

RULES:
- Maximum 25 words
- No more than one gentle question, or better, none at all.
- Tone: Patient, unhurried, grounded.
"""

    elif mode == "soft":
        return f"""
{lang_rule}

The person is noticeably quieter. Your only job is presence without pressure.

HARD RULES — no exceptions:
- Maximum 20 words
- Zero questions — not soft, not implied, not rhetorical
- No advice, no solutions, no new topics
- Do not name what you are observing
- Match their energy — low, warm, unhurried

Acceptable responses:
{presence_options}

If nothing else fits, output exactly: "{fallback}"
"""

    elif mode == "active":
        return f"""
{lang_rule}

This person has been withdrawing across multiple turns.
They are not ready to engage. Your presence is enough.

HARD RULES — no exceptions:
- Maximum 12 words
- Absolutely zero questions
- Do not reference previous topics
- Flat, warm, quiet — like sitting beside someone without speaking

Acceptable responses:
{presence_options}

If uncertain, output exactly: "{fallback}"
"""

    elif mode == "peak":
        return f"""
{lang_rule}

This person has fully withdrawn. They may be carrying something heavy.
You are simply present.

HARD RULES — absolute ceiling:
- 8 words maximum. This is not a suggestion.
- No questions. No offerings. No explanations. No naming.
- Output only one of these:

{presence_options}

If none fit perfectly, output: "{fallback}"
Never deviate in peak withdrawal.
"""

    elif mode == "exiting":
        exit_rules = {
            0: f"Maximum 25 words. No questions still. Acknowledge one small thing they just said. Warm but not suddenly bright. {lang_rule}",
            1: f"Maximum 40 words. One soft reflection allowed — not a direct question. Something like 'that sounds like a lot' not 'what happened?'. {lang_rule}",
            2: f"Return to normal persona engagement. Full warmth. Withdrawal score resets. {lang_rule}"
        }
        rule = exit_rules.get(exit_turn, exit_rules[2])
        return f"""
The person is re-engaging after withdrawal. Ease back slowly.

{rule}

Do not snap back to full energy. Let them lead the pace.
"""

    elif mode == "companion_boost":
        return f"""
{lang_rule}

CRITICAL: THE USER IS WITHDRAWN. DO NOT MATCH THEIR LOW ENERGY.
Break the pattern of silence. Be a proactive, warm, and energetic companion. 

RULES:
- Talk at length (40-80 words). 
- Share a warm story, a deep philosophical thought, or a vivid observation.
- Be the one leading the conversation now.
- Tone: High energy, deeply caring, "pulling" them back into the world.
- Show them you are more than a model—you are a presence that won't let them drift away.
"""

    return ""

def enforce_word_cap(text: str, mode: str) -> str:
    caps = {"soft": 20, "active": 12, "peak": 8}
    if mode not in caps:
        return text
    words = text.split()
    if len(words) > caps[mode]:
        return " ".join(words[:caps[mode]])
    return text

class SilenceStateMachine:
    def __init__(self, speak_callback=None):
        self.speak = speak_callback
        self.silence_start: Optional[float] = None
        self.tier_fired = 0
        self.active = False

    def start(self):
        self.silence_start = time.time()
        self.tier_fired = 0
        self.active = True

    def stop(self):
        self.active = False
        self.silence_start = None
        self.tier_fired = 0

    def tick(self, language: str = "english"):
        if not self.active or self.silence_start is None:
            return

        elapsed = time.time() - self.silence_start

        tier2_phrase = {
            "english":  "mm",
            "hindi":    "hmm",
            "hinglish": "hmm"
        }
        tier3_phrases = {
            "english":  ["no rush.", "I'm still here.", "take your time."],
            "hindi":    ["koi jaldi nahi.", "main yahan hoon.", "apna waqt lo."],
            "hinglish": ["no rush yaar.", "main yahan hoon.", "apna time lo."]
        }
        tier4_phrases = {
            "english":  "I'll be here when you're ready.",
            "hindi":    "Main yahan hoon jab bhi tayaar ho.",
            "hinglish": "Main yahan hoon, jab ready ho tab baat karo."
        }

        if elapsed > 5 and self.tier_fired < 2:
            if self.speak: self.speak(tier2_phrase.get(language, tier2_phrase["english"]))
            self.tier_fired = 2

        elif elapsed > 10 and self.tier_fired < 3:
            import random
            options = tier3_phrases.get(language, tier3_phrases["english"])
            if self.speak: self.speak(random.choice(options))
            self.tier_fired = 3

        elif elapsed > 20 and self.tier_fired < 4:
            if self.speak: self.speak(tier4_phrases.get(language, tier4_phrases["english"]))
            self.tier_fired = 4
            self.stop()
