import re
import json
from collections import defaultdict, Counter
from datetime import datetime


class VocabLearner:
    """
    Learns and stores per-user vocabulary patterns.
    Tracks:
    - Signature words and phrases per user
    - Abuse vocabulary specific to this user
    - Emotional trigger words
    - Greeting and closing patterns
    - Topic patterns per emotional state
    """

    def __init__(self):
        self._profiles: dict = {}

    def get_profile(self, user_id: str) -> dict:
        if user_id not in self._profiles:
            self._profiles[user_id] = {
                "signature_words": Counter(),
                "abuse_vocab": Counter(),
                "greeting_patterns": Counter(),
                "emotional_words": {
                    "anger": Counter(),
                    "sadness": Counter(),
                    "joy": Counter(),
                    "frustration": Counter(),
                    "neutral": Counter(),
                },
                "filler_words": Counter(),
                "topic_clusters": defaultdict(Counter),
                "sentence_length_avg": 0.0,
                "sentence_count": 0,
                "language_mode_history": Counter(),
                "last_updated": datetime.utcnow().isoformat(),
            }
        return self._profiles[user_id]

    def ingest_turn(
        self,
        user_id: str,
        text: str,
        lang_profile: dict,
        emotional_state: str = "neutral",
        is_greeting: bool = False
    ):
        profile = self.get_profile(user_id)
        words = re.findall(r'\b\w+\b', text.lower())

        # Track language mode history
        mode = lang_profile.get("mode", "english")
        profile["language_mode_history"][mode] += 1

        # Track sentence length
        n = profile["sentence_count"]
        avg = profile["sentence_length_avg"]
        profile["sentence_length_avg"] = (avg * n + len(words)) / (n + 1)
        profile["sentence_count"] += 1

        # Track abuse vocabulary with full words
        if lang_profile.get("has_abuse"):
            abuse_markers = [
                "madarchod", "behenchod", "bhenchod",
                "chutiya", "bhosdike", "gaandu", "lodu",
                "harami", "kamina", "saala", "lauda",
                "fuck", "fucking", "shit", "bastard",
                "bitch", "asshole", "motherfucker",
                "maa ki", "teri maa", "teri behen",
            ]
            for word in words:
                if word in abuse_markers:
                    profile["abuse_vocab"][word] += 1
            for marker in ["maa ki", "teri maa", "teri behen"]:
                if marker in text.lower():
                    profile["abuse_vocab"][marker] += 1

        # Track greeting patterns
        greeting_signals = [
            "yaar", "bhai", "dost", "buddy", "hey",
            "heyy", "heyyy", "hello", "hi", "abe",
            "oye", "arrey", "bro", "sis"
        ]
        if is_greeting or profile["sentence_count"] <= 2:
            for word in words:
                if word in greeting_signals:
                    profile["greeting_patterns"][word] += 1

        # Track emotional words per state
        stop_words = {
            "the", "a", "an", "is", "it", "in", "on",
            "at", "to", "for", "of", "and", "or", "but",
            "hai", "tha", "thi", "ka", "ki", "ke", "se",
            "mein", "ko", "ne", "aur", "ya", "par", "bhi"
        }
        significant_words = [
            w for w in words if len(w) > 3 and w not in stop_words
        ]
        for word in significant_words:
            profile["emotional_words"][emotional_state][word] += 1

        # Track filler and signature words
        filler_signals = [
            "basically", "actually", "honestly", "literally",
            "like", "you know", "matlab", "matlab bolo",
            "matlab yaar", "samajh", "pata hai", "suno",
            "dekho", "arre", "waise", "toh"
        ]
        for filler in filler_signals:
            if filler in text.lower():
                profile["filler_words"][filler] += 1

        for word in significant_words:
            profile["signature_words"][word] += 1

        for word in significant_words:
            profile["topic_clusters"][emotional_state][word] += 1

        profile["last_updated"] = datetime.utcnow().isoformat()

    def get_vocab_summary(self, user_id: str) -> dict:
        profile = self.get_profile(user_id)
        if profile["sentence_count"] == 0:
            return {}

        top_signature = [
            w for w, _ in profile["signature_words"].most_common(10)
        ]
        top_abuse = [
            w for w, _ in profile["abuse_vocab"].most_common(5)
        ]
        dominant_lang = (
            profile["language_mode_history"].most_common(1)[0][0]
            if profile["language_mode_history"]
            else "english"
        )
        top_greeting = (
            profile["greeting_patterns"].most_common(1)[0][0]
            if profile["greeting_patterns"]
            else None
        )
        avg_len = round(profile["sentence_length_avg"], 1)
        response_length_hint = (
            "very_short" if avg_len < 5
            else "short" if avg_len < 10
            else "medium" if avg_len < 20
            else "long"
        )
        return {
            "dominant_language": dominant_lang,
            "signature_words": top_signature,
            "abuse_vocab": top_abuse,
            "top_greeting": top_greeting,
            "avg_sentence_length": avg_len,
            "response_length_hint": response_length_hint,
            "total_turns": profile["sentence_count"],
        }

    def build_vocab_injection(self, user_id: str) -> str:
        summary = self.get_vocab_summary(user_id)
        if not summary or summary.get("total_turns", 0) < 3:
            return ""

        lines = []
        if summary.get("dominant_language"):
            lines.append(
                f"User's dominant language: {summary['dominant_language']}"
            )
        if summary.get("signature_words"):
            lines.append(
                f"Words they use often: "
                f"{', '.join(summary['signature_words'][:6])}"
            )
        if summary.get("abuse_vocab"):
            lines.append(
                f"Their abuse vocabulary — use these naturally "
                f"if the tone calls for it, never force them: "
                f"{', '.join(summary['abuse_vocab'])}"
            )
        if summary.get("top_greeting"):
            lines.append(
                f"They often open with: {summary['top_greeting']}"
            )
        if summary.get("response_length_hint"):
            lines.append(
                f"Their avg message length suggests "
                f"your responses should be: "
                f"{summary['response_length_hint']}"
            )
        if not lines:
            return ""

        return (
            "\n[USER VOCAB PROFILE]\n"
            + "\n".join(lines)
            + "\n[END VOCAB PROFILE]"
        )

    def serialize(self, user_id: str) -> str:
        summary = self.get_vocab_summary(user_id)
        return json.dumps(summary, ensure_ascii=False)

    def load_from_seed(self, user_id: str, vocab_json: str):
        try:
            data = json.loads(vocab_json)
            profile = self.get_profile(user_id)
            for w in data.get("signature_words", []):
                profile["signature_words"][w] += 5
            for w in data.get("abuse_vocab", []):
                profile["abuse_vocab"][w] += 5
            greeting = data.get("top_greeting")
            if greeting:
                profile["greeting_patterns"][greeting] += 5
            lang = data.get("dominant_language", "english")
            profile["language_mode_history"][lang] += 10
        except Exception:
            pass


# Global singleton — one per server process
vocab_learner = VocabLearner()
