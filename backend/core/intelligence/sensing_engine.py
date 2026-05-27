import re
import time
from typing import Dict

# Very basic heuristic keyword matching for emotions
_EMOTION_KEYWORDS = {
    "frustration": ["ugh", "damn", "shit", "fuck", "annoy", "hate", "stop", "bad", "no", "why", "wtf"],
    "trust": ["friend", "love", "thanks", "thank", "agree", "yes", "sure", "ok", "okay", "understand", "good"],
    "engagement": ["wow", "cool", "interesting", "tell me", "what else", "really", "omg", "amazing"],
    "playfulness": ["haha", "lol", "lmao", "funny", "joke", "tease", "silly", "play", "fun", "hehe"],
    "vulnerability": ["sad", "scared", "afraid", "hurt", "alone", "lonely", "help", "cry", "pain", "sorry", "miss"],
    "anxiety": ["nervous", "worried", "anxious", "panic", "stress", "overwhelm", "fear", "hard", "difficult"]
}

class SensingEngineL1:
    def __init__(self):
        self.last_message_time = time.time()
        self.last_message_length = 0

    def analyze(self, text: str, response_speed_ms: float = 0) -> Dict[str, float]:
        text_lower = text.lower()
        words = re.findall(r'\w+', text_lower)
        num_words = max(len(words), 1)
        
        # 1. Keyword Patterns
        scores = {emotion: 0.0 for emotion in _EMOTION_KEYWORDS}
        for emotion, keywords in _EMOTION_KEYWORDS.items():
            matches = sum(1 for kw in keywords if kw in text_lower)
            # normalized by log or length, here just capped basic logic
            scores[emotion] = min(matches * 0.25, 1.0)
            
        # 2. Punctuation Density
        exclamation_count = text.count("!")
        question_count = text.count("?")
        dot_count = text.count(".")
        
        if exclamation_count > 0:
            scores["frustration"] = min(scores["frustration"] + (exclamation_count * 0.1), 1.0)
            scores["engagement"] = min(scores["engagement"] + (exclamation_count * 0.1), 1.0)
            
        if question_count > 0:
            scores["engagement"] = min(scores["engagement"] + (question_count * 0.1), 1.0)
            scores["anxiety"] = min(scores["anxiety"] + (question_count * 0.05), 1.0)
            
        # 3. Message Length Deltas
        length_delta = len(text) - self.last_message_length
        if length_delta > 50:
            scores["engagement"] = min(scores["engagement"] + 0.2, 1.0)
            scores["vulnerability"] = min(scores["vulnerability"] + 0.1, 1.0)
        elif length_delta < -50 and len(text) < 10:
            scores["frustration"] = min(scores["frustration"] + 0.1, 1.0)
            scores["engagement"] = max(scores["engagement"] - 0.2, 0.0)

        # 4. Response Speed
        if response_speed_ms > 0:
            if response_speed_ms < 1000:
                scores["engagement"] = min(scores["engagement"] + 0.1, 1.0)
                scores["anxiety"] = min(scores["anxiety"] + 0.1, 1.0)
            elif response_speed_ms > 5000:
                scores["vulnerability"] = min(scores["vulnerability"] + 0.1, 1.0)
                scores["frustration"] = min(scores["frustration"] + 0.1, 1.0)

        # Update state for next turn
        self.last_message_length = len(text)
        self.last_message_time = time.time()
        
        return scores

sensing_engine_l1 = SensingEngineL1()
