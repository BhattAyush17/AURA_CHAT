"""
AURA Behavior Engine v4 (Lightweight Edition)
Focus: Keywords + Multi-State Emotional Routing
"""

import os
import json
import re
import time
from typing import Dict, Any, List, Tuple, Optional
from dotenv import load_dotenv

load_dotenv(".env.local")

from emotional_router import EmotionalStateRouter
from withdrawal_detector import SilenceStateMachine, enforce_word_cap
from sensing_engine import SensingEngine
from response_director import direct_response

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
_sensing_engines: dict[str, SensingEngine] = {}

def get_sensing_engine(session_id: str, seed: str = "") -> SensingEngine:
    if session_id not in _sensing_engines:
        _sensing_engines[session_id] = SensingEngine(previous_seed=seed)
    return _sensing_engines[session_id]

def build_sensing_injection(session_id: str, turn: dict, seed: str = "") -> tuple:
    engine = get_sensing_engine(session_id, seed)
    state = engine.ingest(turn)
    directive = direct_response(state)

    if directive["mode"] == "normal":
        return "", state, "passive"

    injection = f"""
[AURA SENSING — TURN {state.session_turn}]
Arc: {state.arc} (turn {state.arc_turns} in arc)
Energy: {round(state.energy, 2)} Δ{round(state.energy_delta, 2)} | Warmth: {round(state.warmth, 2)}
Engagement: {round(state.engagement, 2)} | Trust: {round(state.trust, 2)} | Tension: {round(state.tension, 2)}
Mode: {directive["mode"]} | Length: {directive["length"]} | Vocal: {directive["vocal_energy"]}

{directive["instruction"].strip()}
[END SENSING]
    """.strip()
    return injection, state, directive["injection_type"]

class RuntimeEngine:
    def __init__(self, data_dir: str = "./extracted_data", db_dir: str = None):
        print("[AURA] Initializing Behavior Engine v4 (Emotional Routing)...")
        self.keywords = KeywordMapManager(os.path.join(data_dir, "_keyword_maps.json"))
        self.templates = TemplateManager(os.path.join(data_dir, "_all_templates.json"))
        self.emotion_router = EmotionalStateRouter()
        self.silence_machine = SilenceStateMachine()
        self.turn_history = []
        print("[AURA] Emotional Engine Ready.")
    
    def analyze(self, transcript: str, ideology: Optional[str] = None, user_initiated: bool = True) -> dict:
        # STOP silence tracking (user just spoke)
        self.silence_machine.stop()
        
        current_turn = {"text": transcript, "user_initiated": user_initiated}
        
        # ROUTE emotional state
        routing = self.emotion_router.resolve(self.turn_history, current_turn)
        
        # Track history
        self.turn_history.append(current_turn)
        if len(self.turn_history) > 10: self.turn_history.pop(0)

        # Standard Analysis
        act = detect_speech_act(transcript)
        kw_result = self.keywords.scan(transcript, ideology)
        energy = detect_energy(transcript)
        
        # START silence tracking (AURA about to speak)
        self.silence_machine.start()
        
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
            "sensing_injection": analysis_payload.get("sensing_injection", "") # placeholder, will be set in server.py or here
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
[/AURA_GROWTH]
{relational_memory_block}

RULES:
— SEED block maximum 60 tokens
— Transform what changed, never delete
— If nothing changed a line, carry it forward unchanged
— If something resolved, move it to SHIFT
— THREAD line is sacred — never compress it away
— Return nothing except the three blocks above

At the end of the seed, append exactly one line in this format with no extra text:
[RM] trust:{trust_level} energy:{avg_energy} arc:{dominant_arc} boosts:{companion_boost_count} withdrawals:{total_withdrawals} peak:{peak_reached} [/RM]

Replace each value with the actual number from the conversation.
Keep this line under 30 tokens. Do not explain it.
"""

def generate_memory_seed(
    transcript: list,
    previous_seed: str = "",
    api_key: str = "",
    arc_summary: str = ""
) -> str:
    """
    Takes full conversation transcript.
    Returns compressed 60-token seed string.
    Single secondary LLM call.
    """
    
    # Build readable transcript from turn history
    transcript_text = "\n".join([
        f"{'User' if t.get('user_initiated') else 'AURA'}: {t.get('text', '')}"
        for t in transcript[-30:]  # last 30 turns max
    ])
    
    # Keep transcript under 1500 chars
    if len(transcript_text) > 1500:
        transcript_text = transcript_text[-1500:]
    
    prompt = SEED_GENERATION_PROMPT.format(
        previous_seed=previous_seed or "none — first conversation",
        transcript=transcript_text
    )
    if arc_summary:
        prompt += f"\n\nRelational memory to preserve:\n{arc_summary}"
    
    # Secondary Gemini call — cheap, fast, small output
    response = call_gemini_raw(
        system="You are a memory compression engine. Return only the seed blocks.",
        user=prompt,
        max_tokens=150,  # hard cap — seed never exceeds this
        api_key=api_key
    )
    
    return response.strip()

def call_gemini_raw(system: str, user: str, max_tokens: int = 150, api_key: str = "") -> str:
    """
    Bare Gemini call for internal operations.
    No emotional routing. No prompt injection.
    Just the call.
    """
    import google.generativeai as genai
    
    # Use user key if provided, fall back to server key
    key_to_use = api_key if api_key else os.getenv("GEMINI_API_KEY")
    
    if not key_to_use:
        raise ValueError("No API key available for seed generation")
        
    # Configure for this specific call
    genai.configure(api_key=key_to_use)
    model = genai.GenerativeModel(
        model_name="gemini-flash-latest",  # fastest, cheapest model
        safety_settings=[
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ],
        system_instruction=system
    )
    
    response = model.generate_content(
        user,
        generation_config=genai.types.GenerationConfig(
            max_output_tokens=max_tokens,
            temperature=0.3  # low temp — consistent compression
        )
    )
    
    return response.text
