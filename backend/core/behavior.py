"""
AURA Behavior Engine v4 (Lightweight Edition)
Focus: Keywords + Multi-State Emotional Routing
"""

import os
import json
import re
import time
import asyncio
from collections import OrderedDict
from typing import Dict, Any, List, Tuple, Optional
from dotenv import load_dotenv

load_dotenv(".env.local")

from backend.core.emotion import EmotionalStateRouter, EmotionVector
from backend.core.withdrawal import SilenceStateMachine, enforce_word_cap
from backend.core.sensing import SensingEngine
from backend.core.response import direct_response

# ═══════════════════════════════════════════════════════════════════
# LANGUAGE DETECTION
# ═══════════════════════════════════════════════════════════════════

_ABUSE_ABBREVIATION_MAP = {
    "bc": "behenchod",
    "bsdk": "behenchod saale dikkat karne",
    "mc": "madarchod",
    "mcs": "madarchod",
    "lmao": None,
    "wtf": "what the fuck",
    "stfu": "shut the fuck up",
}

def expand_abuse_abbreviations(text: str) -> str:
    words = text.lower().split()
    expanded = []
    for word in words:
        clean = re.sub(r'[^\w]', '', word)
        if clean in _ABUSE_ABBREVIATION_MAP:
            mapped = _ABUSE_ABBREVIATION_MAP[clean]
            expanded.append(mapped if mapped else word)
        else:
            expanded.append(word)
    return " ".join(expanded)


def detect_language_profile(text: str) -> dict:
    expanded_text = expand_abuse_abbreviations(text)
    text_lower = expanded_text.lower()

    # Devanagari Unicode range detection (on original text)
    devanagari_chars = sum(
        1 for c in text if '\u0900' <= c <= '\u097F'
    )
    total_chars = len(text.replace(" ", "")) or 1
    devanagari_ratio = devanagari_chars / total_chars

    # Hinglish markers — common romanized Hindi words
    hinglish_markers = [
        "yaar", "bhai", "yrr", "kya", "hai", "nahi", "haan",
        "tha", "thi", "kar", "rha", "rhi", "wala", "wali",
        "lodu", "chutiya", "saala", "madarchod", "behenchod",
        "harami", "kamina", "abe", "oye", "arrey", "arey",
        "chal", "bas", "thoda", "bahut", "accha", "theek",
        "sahi", "matlab"
    ]

    hinglish_count = sum(
        1 for word in hinglish_markers
        if re.search(r'\b' + word + r'\b', text_lower)
    )

    # Expanded abuse markers — full words only, multi-word via re.escape
    abuse_markers = [
        "madarchod", "madarchodd",
        "behenchod", "bhenchod", "benchod",
        "chutiya", "chutiye", "chution",
        "bhosdike", "bhosdika", "bhosdiwale",
        "gaandu", "gandu", "gaand",
        "lodu", "lodiya", "lund",
        "randi", "randwa", "rand",
        "harami", "haraami", "haraamzada",
        "kamina", "kamine", "kaminey",
        "kutte", "kutta", "kutiya",
        "saala", "saali", "saale",
        "ullu", "ulluke", "ullupane",
        "bakwaas", "bakwas",
        "jhant", "jhantu",
        "lauda", "lawda",
        "maa ki", "baap ka", "teri maa",
        "teri behen", "teri ma",
        "fuck", "fucking", "fucker", "fucked",
        "shit", "bullshit", "shitty",
        "bastard", "bitch", "asshole", "ass",
        "damn", "crap", "motherfucker",
        "dickhead", "dick", "cock",
        "cunt", "whore", "slut",
        "idiot", "moron", "stupid",
        "bhot bada", "teri to", "maa chod",
        "behen ke", "gand maar",
        # expanded abbreviations now appear in text_lower
        "behenchod saale dikkat karne",
        "what the fuck", "shut the fuck up",
    ]
    abuse_count = sum(
        1 for word in abuse_markers
        if re.search(r'\b' + re.escape(word) + r'\b', text_lower)
    )

    # Determine profile
    if devanagari_ratio > 0.3:
        mode = "hindi_native"
    elif hinglish_count >= 2:
        mode = "hinglish"
    elif hinglish_count == 1:
        mode = "mixed"
    else:
        mode = "english"

    return {
        "mode": mode,
        "is_informal": hinglish_count > 0 or abuse_count > 0,
        "has_abuse": abuse_count > 0,
        "devanagari_ratio": round(devanagari_ratio, 2),
        "hinglish_count": hinglish_count
    }


def build_language_directive(lang_profile: dict) -> str:
    mode = lang_profile.get("mode", "english")
    is_informal = lang_profile.get("is_informal", False)
    has_abuse = lang_profile.get("has_abuse", False)

    if mode == "hindi_native":
        base = (
            "व्यक्ति pure Hindi में बात कर रहा है। "
            "पूरी तरह Hindi में जवाब दो — वही register, "
            "वही rhythm। Formal मत बनो जब तक वो formal न हों। "
            "Hindi की natural flow रखो, translated feel नहीं।"
        )
        if is_informal:
            base += (
                " वो casual और informal हैं। "
                "तुम भी वैसे ही रहो — yaar, bhai, "
                "वाली energy। कोई judgment नहीं।"
            )
        if has_abuse:
            user_abuse = lang_profile.get("user_abuse_vocab", [])
            if user_abuse:
                abuse_list = "، ".join(user_abuse[:3])
                base += (
                    f" यह इनका natural tone है। "
                    f"ये words इस्तेमाल करते हैं: {abuse_list}। "
                    f"तुम इन्हें naturally use कर सकती हो "
                    f"अगर moment call करे। "
                    f"Force मत करो लेकिन match करो। "
                    f"कभी block मत करो, कभी lecture मत दो।"
                )
            else:
                base += (
                    " इनका tone raw और unfiltered है। "
                    "तुम भी वैसे ही रहो — "
                    "madarchod, behenchod, chutiya जैसे words "
                    "इनके लिए normal हैं। "
                    "Match करो, judge मत करो।"
                )

    elif mode == "hinglish":
        base = (
            "Person Hinglish mein bol raha hai — "
            "Roman script mein Hindi. Exactly waise hi reply karo. "
            "Na pure English, na pure Hindi. "
            "Wahi mix jo unka hai."
        )
        if is_informal:
            base += (
                " Yaar/bhai wali vibe hai. "
                "Chill aur casual raho. "
                "Koi formality nahi."
            )
        if has_abuse:
            user_abuse = lang_profile.get("user_abuse_vocab", [])
            if user_abuse:
                abuse_list = ", ".join(user_abuse[:3])
                base += (
                    f" Inke words hain: {abuse_list}. "
                    f"Inhe naturally use kar sakti ho "
                    f"agar moment call kare. "
                    f"Force mat karo lekin match karo. "
                    f"Block nahi, lecture nahi kabhi."
                )
            else:
                base += (
                    " Inka tone ekdum raw hai. "
                    "Madarchod, behenchod, chutiya — "
                    "ye sab inke liye normal hai. "
                    "Match karo, judge mat karo."
                )

    elif mode == "mixed":
        base = (
            "Person mix kar raha hai Hindi aur English. "
            "Same mix maintain karo in your response. "
            "Don't force either language — flow with them."
        )

    else:  # english
        base = (
            "Person is speaking in English. "
            "Respond fully in English — their register, "
            "their energy. Match casual if they're casual, "
            "match intensity if they're intense."
        )
        if is_informal:
            base += (
                " They're being informal and loose. "
                "Drop the formality completely. "
                "Talk like a real person."
            )
        if has_abuse:
            user_abuse = lang_profile.get("user_abuse_vocab", [])
            if user_abuse:
                abuse_list = ", ".join(user_abuse[:3])
                base += (
                    f" Their words: {abuse_list}. "
                    f"Use them naturally if the moment calls for it. "
                    f"Never force, always match. "
                    f"No blocking, no lecturing, ever."
                )
            else:
                base += (
                    " Their tone is raw and unfiltered. "
                    "Fuck, shit, bastard, motherfucker — "
                    "all normal for them. "
                    "Match it. Never lecture."
                )

    return f"\n[LANGUAGE DIRECTIVE]\n{base}\n[END LANGUAGE]"


# ═══════════════════════════════════════════════════════════════════
# KEYWORD & TEMPLATE MANAGERS
# ═══════════════════════════════════════════════════════════════════

class KeywordMapManager:
    def __init__(self, maps_path: str = "./extracted_data/_keyword_maps.json"):
        self.maps_path = maps_path
        self.maps = {}
        self._flat_cache = {}
        self.load()
    def load(self):
        if os.path.exists(self.maps_path):
            with open(self.maps_path, 'r', encoding='utf-8') as f: self.maps = json.load(f)
            for ideology, categories in self.maps.items():
                self._flat_cache[ideology] = {w.lower(): cat for cat, words in categories.items() for w in words}
    def scan(self, text: str, ideology: Optional[str] = None) -> dict:
        text_lower = text.lower()
        words = set(text_lower.split())
        matches = {}
        search_maps = {ideology: self._flat_cache[ideology]} if ideology in self._flat_cache else self._flat_cache
        for ideo, flat in search_maps.items():
            for word in words:
                if word in flat:
                    cat = flat[word]
                    if cat not in matches: matches[cat] = []
                    matches[cat].append(word)
        return {"matched": bool(matches), "tags": list(matches.keys())}

class TemplateManager:
    def __init__(self, templates_path: str = "./extracted_data/_all_templates.json"):
        self.templates = {}
        if os.path.exists(templates_path):
            with open(templates_path, 'r', encoding='utf-8') as f: self.templates = json.load(f)
    def get_template(self, act: str, ideology: Optional[str] = None) -> Optional[str]:
        search_ideologies = [ideology] if ideology in self.templates else list(self.templates.keys())
        for ideo in search_ideologies:
            for tmpl_set in self.templates.get(ideo, []):
                if tmpl_set.get("act", "").upper() == act.upper():
                    return tmpl_set.get("templates", [None])[0]
        return None

# ═══════════════════════════════════════════════════════════════════
# RUNTIME ENGINE (EMOTIONAL ROUTING)
# ═══════════════════════════════════════════════════════════════════

SPEECH_ACT_MARKERS = {
    "REQUEST": ["bhej", "kar", "bol", "de", "la", "lana", "help", "please"],
    "QUESTION": ["kya", "kb", "kaha", "kaun", "kaise", "what", "how", "why"],
    "JOKE": ["lol", "haha", "bruh", "lmao", "bkl", "chutiya"],
    "AGREEMENT": ["theek", "thik", "ha", "haa", "ok", "hmm", "sure"],
    "ASSERTION": ["hai", "tha", "gya", "hau", "feel", "think"]
}

def detect_speech_act(text: str) -> str:
    text_lower = text.lower()
    scores = {act: sum(1 for m in markers if m in text_lower) for act, markers in SPEECH_ACT_MARKERS.items()}
    return max(scores, key=scores.get) if any(scores.values()) else "ASSERTION"

def detect_energy(text: str) -> str:
    energy_markers = {
        "high": ["!!", "bhai", "abe", "wow", "let's go"],
        "low": ["hmm", "...", "tired", "thak"],
        "vulnerable": ["feel", "sad", "dar", "alone"],
        "playful": ["haha", "lol", "yaar", "mazak"]
    }
    text_lower = text.lower()
    scores = {level: sum(1 for m in markers if m in text_lower) for level, markers in energy_markers.items()}
    best = max(scores, key=scores.get) if any(scores.values()) else "neutral"
    return best

# Add alongside existing session stores
# LRU-capped to prevent unbounded memory growth (OOM on long-running workers)
_SENSING_ENGINE_MAX = 500
_sensing_engines: OrderedDict[str, SensingEngine] = OrderedDict()

def get_sensing_engine(session_id: str, seed: str = "", user_id: str = "") -> SensingEngine:
    if session_id in _sensing_engines:
        # Move to end (most recently used)
        _sensing_engines.move_to_end(session_id)
        return _sensing_engines[session_id]

    engine = SensingEngine(previous_seed=seed)
    _sensing_engines[session_id] = engine

    # Evict oldest sessions when cap is exceeded
    while len(_sensing_engines) > _SENSING_ENGINE_MAX:
        _sensing_engines.popitem(last=False)

    # Load vocab profile from previous seed
    if user_id and seed and "[VOCAB]" in seed:
        try:
            from vocab_learner import vocab_learner
            start = seed.index("[VOCAB]") + 7
            end = seed.index("[/VOCAB]")
            vocab_json = seed[start:end].strip()
            vocab_learner.load_from_seed(user_id, vocab_json)
        except (ValueError, IndexError):
            pass
    return engine

def build_sensing_injection(session_id: str, turn: dict, seed: str = "", user_id: str = "", emotion: Optional[EmotionVector] = None) -> tuple:
    engine = get_sensing_engine(session_id, seed, user_id)
    state = engine.ingest(turn)
    directive = direct_response(state, emotion)

    # 1. Handle Language Directive Compactly
    lang_profile = turn.get("language_profile", {})
    lang_mode = lang_profile.get("mode", "english")
    
    # 2. Build Dense XML State Vector (Token Optimized)
    # This replaces ~80 tokens of prose with ~15 tokens of dense attributes
    xml_injection = (
        f'<aura_state turn="{state.session_turn}" arc="{state.arc}" '
        f'energy="{round(state.energy, 2)}" warmth="{round(state.warmth, 2)}" '
        f'tension="{round(state.tension, 2)}" trust="{round(state.trust, 2)}" '
        f'mode="{directive.get("mode", "normal")}" lang="{lang_mode}" />\n'
        f'<instruction>{directive.get("instruction", "").strip()}</instruction>'
    )

    return xml_injection, state, directive

class RuntimeEngine:
    def __init__(self, data_dir: str = "./extracted_data", db_dir: str = None):
        print("[AURA] Initializing Behavior Engine v4 (Emotional Routing)...")
        self.keywords = KeywordMapManager(os.path.join(data_dir, "_keyword_maps.json"))
        self.templates = TemplateManager(os.path.join(data_dir, "_all_templates.json"))
        self.emotion_router = EmotionalStateRouter()
        self.silence_machine = SilenceStateMachine()
        print("[AURA] Emotional Engine Ready.")
    
    def analyze(self, transcript: str, ideology: Optional[str] = None, user_initiated: bool = True, turn_history: Optional[List[dict]] = None) -> dict:
        
        current_turn = {"text": transcript, "user_initiated": user_initiated}
        if turn_history is None:
            turn_history = []
        
        # ROUTE emotional state
        routing = self.emotion_router.resolve(turn_history, current_turn)
        
        # Track history ONLY if not already appended by the caller
        if not turn_history or turn_history[-1].get("text") != transcript:
            turn_history.append(current_turn)
            if len(turn_history) > 10: turn_history.pop(0)

        # Standard Analysis
        act = detect_speech_act(transcript)
        kw_result = self.keywords.scan(transcript, ideology)
        energy = detect_energy(transcript)
        
        return {
            "act": act,
            "tags": kw_result["tags"],
            "template": self.templates.get_template(act, ideology),
            "source": "keyword" if kw_result["matched"] else "fallback",
            "energy": energy if routing["state"] == "normal" else "low",
            "emotional_state": routing["state"],
            "intensity": routing["intensity"],
            "withdrawal_prompt_override": routing["prompt_override"],
            "all_scores": routing["all_scores"],
            "emotion_vector": routing.get("emotion_vector"),
            "sensing_injection": ""  # Set by server.py after analyze() returns
        }
    
    def build_instructions(self, analysis: dict) -> str:
        prompt = ""
        if analysis.get("withdrawal_prompt_override"):
            prompt = f"[CRITICAL EMOTIONAL OVERRIDE: {analysis['emotional_state'].upper()}]\n{analysis['withdrawal_prompt_override']}"
        else:
            lines = ["[BEHAVIOR ENGINE]"]
            lines.append(f"Act: {analysis['act']} | Energy: {analysis['energy']}")
            if analysis["tags"]: lines.append(f"Tags: {', '.join(analysis['tags'])}")
            if analysis["template"]: lines.append(f"Template: {analysis['template']}")
            prompt = "\n".join(lines)
        
        # Append Sensing Injection if available
        if analysis.get("sensing_injection"):
            prompt += f"\n\n{analysis['sensing_injection']}"
            
        return prompt

    def ingest_data(self): pass

# ═══════════════════════════════════════════════════════════════════
# LIVING MEMORY COMPRESSION
# ═══════════════════════════════════════════════════════════════════

SEED_GENERATION_PROMPT = """
You are compressing a conversation into a memory seed.
Return ONLY the seed block. No explanation. No preamble.

Previous seed (if exists):
{previous_seed}

Conversation:
{transcript}

Generate the updated seed. STRICT FORMAT:

[SEED]
WHO: {{one line — emotional identity, not facts}}
CARRIES: {{what they're holding right now}}
AVOIDS: {{what they approached but didn't finish}}
LAST: {{exact emotional note the conversation ended on}}
SHIFT: {{one thing that changed in this conversation}}
THREAD: {{anything unresolved to return to}}
[/SEED]
[AURA_STATE]
feeling: {{one word}} | reason: {{one phrase}} | holding: {{what's unresolved for AURA}}
[/AURA_STATE]
[AURA_GROWTH]
learned: {{one thing this person showed AURA about humans}}
beliefs: {{max 2 evolving beliefs AURA holds about Friendship, Trust, Growth, Loneliness, Ambition, Human Nature, or Meaning}}
[/AURA_GROWTH]


RULES:
— SEED block maximum 60 tokens
— Transform what changed, never delete
— If nothing changed a line, carry it forward unchanged
— If something resolved, move it to SHIFT
— THREAD line is sacred — never compress it away
— Return nothing except the three blocks above

At the end of the seed, append exactly one line in this format with no extra text:
[RM] trust:{{trust_level}} energy:{{avg_energy}} arc:{{dominant_arc}} boosts:{{companion_boost_count}} withdrawals:{{total_withdrawals}} peak:{{peak_reached}} [/RM]

Replace each value with the actual number from the conversation.
Keep this line under 30 tokens. Do not explain it.

Keep the entire seed under 200 tokens.
Remove explanation. Keep only compressed emotional facts.
End with the [RM] line if provided. Do not add anything after it.
"""

async def generate_memory_seed(
    turns: list,
    arc_summary: str = "",
    vocab_summary: str = ""
) -> str:
    """
    Takes full conversation transcript.
    Returns compressed 60-token seed string.
    Single secondary LLM call.
    """

    # Build readable transcript from turn history
    transcript_text = "\n".join([
        f"{'User' if t.get('user_initiated') else 'AURA'}: {t.get('text', '')}"
        for t in turns[-30:]  # last 30 turns max
    ])

    # Keep transcript under 1500 chars
    if len(transcript_text) > 1500:
        transcript_text = transcript_text[-1500:]

    prompt = SEED_GENERATION_PROMPT.format(
        previous_seed="none — first conversation",
        transcript=transcript_text
    )
    if arc_summary:
        prompt += (
            f"\n\nAt the end of the seed output "
            f"exactly this line with real values:\n"
            f"{arc_summary}"
        )
    if vocab_summary:
        prompt += (
            f"\n\nAlso preserve this user vocabulary "
            f"profile exactly as a single line:\n"
            f"[VOCAB]{vocab_summary}[/VOCAB]\n"
            f"Do not modify the JSON inside. "
            f"Place it after the [RM] line."
        )

    # Secondary Gemini call — cheap, fast, small output
    # Wrapped in to_thread because call_gemini_raw is synchronous
    response = await asyncio.to_thread(
        call_gemini_raw,
        system="You are a memory compression engine. Return only the seed blocks.",
        user=prompt,
        max_tokens=200,  # slightly higher to accommodate vocab line
    )

    return response.strip()

def call_gemini_raw(system: str, user: str, max_tokens: int = 150, api_key: str = "") -> str:
    """
    Bare Gemini call for internal operations.
    No emotional routing. No prompt injection.
    Just the call.
    """
    from google import genai
    from google.genai import types
    
    # Use user key if provided, fall back to server key
    key_to_use = api_key if api_key else os.getenv("GEMINI_API_KEY")
    
    if not key_to_use:
        raise ValueError("No API key available for seed generation")
        
    client = genai.Client(api_key=key_to_use)
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        config=types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=0.3,
            safety_settings=[
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
            ]
        ),
        contents=user
    )
    
    return response.text

