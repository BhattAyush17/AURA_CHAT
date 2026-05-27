import re
import json
import asyncio
from collections import defaultdict, Counter
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import redis.asyncio as aioredis
    from supabase import Client

# ─── Constants ────────────────────────────────────────────────────────────────

REDIS_KEY_PREFIX = "aura:vocab:"
REDIS_TTL = 86400           # 24 hours
MAX_VOCAB_WORDS = 200       # Hard cap per user
PRUNE_DAYS = 30             # Remove count=1 words not seen for this many days
INJECTION_MIN_COUNT = 3     # Only inject words seen >= N times
INJECTION_TOP_N = 10        # Max words in vocab injection
SAVE_EVERY_N_TURNS = 10     # Auto-save frequency

# ─── Word Entry ───────────────────────────────────────────────────────────────

def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()

def _new_entry(context: str = "") -> dict:
    now = _now_ts()
    return {
        "count": 1,
        "first_seen": now,
        "last_seen": now,
        "contexts": [context] if context else [],
    }

def _update_entry(entry: dict, context: str = "") -> dict:
    entry["count"] += 1
    entry["last_seen"] = _now_ts()
    if context:
        entry["contexts"] = (entry.get("contexts", []) + [context])[-3:]
    return entry

# ─── Serialization helpers ────────────────────────────────────────────────────

def _profile_to_dict(profile: dict) -> dict:
    """Convert in-memory profile (with Counters) to a plain JSON-safe dict."""
    return {
        "word_entries": profile.get("word_entries", {}),       # {word: entry}
        "abuse_vocab": dict(profile["abuse_vocab"]),
        "greeting_patterns": dict(profile["greeting_patterns"]),
        "emotional_words": {k: dict(v) for k, v in profile["emotional_words"].items()},
        "filler_words": dict(profile["filler_words"]),
        "sentence_length_avg": profile["sentence_length_avg"],
        "sentence_count": profile["sentence_count"],
        "language_mode_history": dict(profile["language_mode_history"]),
        "last_updated": profile["last_updated"],
        "turns_since_save": 0,  # reset on save
    }

def _dict_to_profile(data: dict) -> dict:
    """Restore a profile dict from JSON into in-memory structure."""
    return {
        "word_entries": data.get("word_entries", {}),
        "abuse_vocab": Counter(data.get("abuse_vocab", {})),
        "greeting_patterns": Counter(data.get("greeting_patterns", {})),
        "emotional_words": {
            k: Counter(v) for k, v in data.get("emotional_words", {}).items()
        },
        "filler_words": Counter(data.get("filler_words", {})),
        "topic_clusters": defaultdict(Counter),   # not persisted — rebuilt live
        "sentence_length_avg": data.get("sentence_length_avg", 0.0),
        "sentence_count": data.get("sentence_count", 0),
        "language_mode_history": Counter(data.get("language_mode_history", {})),
        "last_updated": data.get("last_updated", datetime.now(timezone.utc).isoformat()),
        "turns_since_save": 0,
    }

# ─── VocabLearner ─────────────────────────────────────────────────────────────

class VocabLearner:
    """
    Learns and stores per-user vocabulary patterns.

    Tracks:
    - Signature words with frequency metadata (count, first/last seen, contexts)
    - Abuse vocabulary specific to this user
    - Emotional trigger words per state
    - Greeting and closing patterns
    - Language mode history and sentence length

    Persistence:
    - load(user_id): Redis → Supabase → fresh start
    - save(user_id): Redis (primary) + Supabase (durable backup, fire-and-forget)
    """

    def __init__(
        self,
        redis_client=None,
        supabase_client=None,
    ):
        self._profiles: dict = {}
        self._redis: Optional["aioredis.Redis"] = redis_client
        self._supabase: Optional["Client"] = supabase_client
        self._loading_tasks: dict = {}

    # ── Profile scaffolding ───────────────────────────────────────────────────

    def _empty_profile(self) -> dict:
        return {
            "word_entries": {},                 # {word: entry_dict}
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
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "turns_since_save": 0,
        }

    def get_profile(self, user_id: str) -> dict:
        if user_id not in self._profiles:
            self._profiles[user_id] = self._empty_profile()
        return self._profiles[user_id]

    # ── Persistence: load ─────────────────────────────────────────────────────

    async def load(self, user_id: str) -> bool:
        """
        Load vocab profile. Order: Redis → Supabase → fresh.
        Returns True if an existing profile was found.
        Handles concurrent load tasks gracefully via a loading task registry.
        """
        if user_id in self._profiles and self._profiles[user_id].get("sentence_count", 0) > 0:
            return True

        if user_id in self._loading_tasks:
            return await self._loading_tasks[user_id]

        async def _do_load():
            # 1. Try Redis
            if self._redis:
                try:
                    raw = await self._redis.get(f"{REDIS_KEY_PREFIX}{user_id}")
                    if raw:
                        self._profiles[user_id] = _dict_to_profile(json.loads(raw))
                        return True
                except Exception:
                    pass  # Redis miss or error — fall through to Supabase

            # 2. Try Supabase
            if self._supabase:
                try:
                    res = await self._supabase.table("aura_storage").select("data").eq("key", f"vocab_profile_{user_id}").eq("user_id", user_id).limit(1).execute()
                    if res.data:
                        self._profiles[user_id] = _dict_to_profile(res.data[0]["data"])
                        # Warm Redis with this data
                        await self._save_to_redis(user_id)
                        return True
                except Exception:
                    pass

            # 3. Fresh start
            self._profiles[user_id] = self._empty_profile()
            return False

        load_task = asyncio.create_task(_do_load())
        self._loading_tasks[user_id] = load_task
        try:
            return await load_task
        finally:
            self._loading_tasks.pop(user_id, None)

    # ── Persistence: save ─────────────────────────────────────────────────────

    async def save(self, user_id: str) -> None:
        """
        Save to Redis (sync) + Supabase (fire-and-forget).
        Prunes vocab before saving.
        """
        self._prune(user_id)
        await self._save_to_redis(user_id)
        asyncio.create_task(self._save_to_supabase(user_id))

    async def _save_to_redis(self, user_id: str) -> None:
        if not self._redis:
            return
        try:
            profile = self.get_profile(user_id)
            payload = json.dumps(_profile_to_dict(profile), ensure_ascii=False)
            await self._redis.set(
                f"{REDIS_KEY_PREFIX}{user_id}", payload, ex=REDIS_TTL
            )
        except Exception:
            pass

    async def _save_to_supabase(self, user_id: str) -> None:
        if not self._supabase:
            return
        try:
            profile = self.get_profile(user_id)
            await self._supabase.table("aura_storage").upsert({
                "user_id": user_id,
                "key": f"vocab_profile_{user_id}",
                "data": _profile_to_dict(profile),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="user_id,key").execute()
        except Exception:
            pass

    def _prune(self, user_id: str) -> None:
        """Remove stale low-frequency words; keep top MAX_VOCAB_WORDS by count."""
        profile = self.get_profile(user_id)
        entries: dict = profile.get("word_entries", {})
        cutoff_ts = _now_ts() - PRUNE_DAYS * 86400

        # Remove count=1 words not seen in PRUNE_DAYS
        pruned = {
            w: e for w, e in entries.items()
            if not (e["count"] == 1 and e["last_seen"] < cutoff_ts)
        }

        # Keep top MAX_VOCAB_WORDS by count
        if len(pruned) > MAX_VOCAB_WORDS:
            top = sorted(pruned.items(), key=lambda x: x[1]["count"], reverse=True)
            pruned = dict(top[:MAX_VOCAB_WORDS])

        profile["word_entries"] = pruned

    # ── Ingestion ─────────────────────────────────────────────────────────────

    def ingest_turn(
        self,
        user_id: str,
        text: str,
        lang_profile: dict,
        emotional_state: str = "neutral",
        is_greeting: bool = False,
    ):
        profile = self.get_profile(user_id)
        words = re.findall(r'\b\w+\b', text.lower())

        # Language mode history
        mode = lang_profile.get("mode", "english")
        profile["language_mode_history"][mode] += 1

        # Sentence length rolling average
        n = profile["sentence_count"]
        avg = profile["sentence_length_avg"]
        profile["sentence_length_avg"] = (avg * n + len(words)) / (n + 1)
        profile["sentence_count"] += 1

        # Abuse vocabulary
        if lang_profile.get("has_abuse"):
            abuse_markers = {
                "madarchod", "behenchod", "bhenchod", "chutiya", "bhosdike",
                "gaandu", "lodu", "harami", "kamina", "saala", "lauda",
                "fuck", "fucking", "shit", "bastard", "bitch", "asshole",
                "motherfucker",
            }
            for word in words:
                if word in abuse_markers:
                    profile["abuse_vocab"][word] += 1
            for marker in ["maa ki", "teri maa", "teri behen"]:
                if marker in text.lower():
                    profile["abuse_vocab"][marker] += 1

        # Greeting patterns
        greeting_signals = {
            "yaar", "bhai", "dost", "buddy", "hey", "heyy", "heyyy",
            "hello", "hi", "abe", "oye", "arrey", "bro", "sis",
        }
        if is_greeting or profile["sentence_count"] <= 2:
            for word in words:
                if word in greeting_signals:
                    profile["greeting_patterns"][word] += 1

        # Stop words for filtering
        stop_words = {
            "the", "a", "an", "is", "it", "in", "on", "at", "to", "for",
            "of", "and", "or", "but", "hai", "tha", "thi", "ka", "ki",
            "ke", "se", "mein", "ko", "ne", "aur", "ya", "par", "bhi",
        }
        significant_words = [w for w in words if len(w) > 3 and w not in stop_words]

        # Emotional words per state
        for word in significant_words:
            profile["emotional_words"][emotional_state][word] += 1

        # Filler words
        filler_signals = [
            "basically", "actually", "honestly", "literally", "like",
            "you know", "matlab", "matlab bolo", "matlab yaar", "samajh",
            "pata hai", "suno", "dekho", "arre", "waise", "toh",
        ]
        for filler in filler_signals:
            if filler in text.lower():
                profile["filler_words"][filler] += 1

        # Signature words with frequency entries
        short_context = text[:80] if len(text) > 80 else text
        entries: dict = profile["word_entries"]
        new_word_learned = False
        for word in significant_words:
            if word in entries:
                _update_entry(entries[word], short_context)
            else:
                entries[word] = _new_entry(short_context)
                new_word_learned = True
            profile["signature_words"] = Counter(
                {w: e["count"] for w, e in entries.items()}
            ) if "signature_words" in profile else Counter()

        # Topic clusters
        for word in significant_words:
            profile["topic_clusters"][emotional_state][word] += 1

        profile["last_updated"] = datetime.now(timezone.utc).isoformat()
        profile["turns_since_save"] = profile.get("turns_since_save", 0) + 1

    # ── Summary & injection ───────────────────────────────────────────────────

    def get_vocab_summary(self, user_id: str) -> dict:
        profile = self.get_profile(user_id)
        if profile["sentence_count"] == 0:
            return {}

        entries: dict = profile.get("word_entries", {})
        top_signature = [
            w for w, _ in sorted(entries.items(), key=lambda x: x[1]["count"], reverse=True)
            if entries[w]["count"] >= INJECTION_MIN_COUNT
        ][:10]

        top_abuse = [w for w, _ in profile["abuse_vocab"].most_common(5)]
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
        profile = self.get_profile(user_id)
        if profile["sentence_count"] < 3:
            return ""

        entries: dict = profile.get("word_entries", {})
        # Frequency-weighted: only words seen >= INJECTION_MIN_COUNT
        qualified = [
            (w, e["count"]) for w, e in entries.items()
            if e["count"] >= INJECTION_MIN_COUNT
        ]
        if not qualified:
            return ""

        top_words = [
            w for w, _ in sorted(qualified, key=lambda x: x[1], reverse=True)[:INJECTION_TOP_N]
        ]
        dominant_lang = (
            profile["language_mode_history"].most_common(1)[0][0]
            if profile["language_mode_history"]
            else "english"
        )

        summary = self.get_vocab_summary(user_id)
        lines = []
        lines.append(f"<vocab words='{','.join(top_words)}' lang='{dominant_lang}' />")

        if summary.get("abuse_vocab"):
            lines.append(
                f"Their abuse vocabulary — use naturally if tone calls for it, never force: "
                f"{', '.join(summary['abuse_vocab'])}"
            )
        if summary.get("top_greeting"):
            lines.append(f"They often open with: {summary['top_greeting']}")
        if summary.get("response_length_hint"):
            lines.append(
                f"Their avg message length suggests responses should be: "
                f"{summary['response_length_hint']}"
            )

        return (
            "\n[USER VOCAB PROFILE]\n"
            + "\n".join(lines)
            + "\n[END VOCAB PROFILE]"
        )

    # ── Serialization (for seed persistence) ─────────────────────────────────

    def serialize(self, user_id: str) -> str:
        summary = self.get_vocab_summary(user_id)
        return json.dumps(summary, ensure_ascii=False)

    def load_from_seed(self, user_id: str, vocab_json: str):
        """Bootstrap a user's vocab from a seed (backward-compatible)."""
        try:
            data = json.loads(vocab_json)
            profile = self.get_profile(user_id)
            entries: dict = profile.setdefault("word_entries", {})
            for w in data.get("signature_words", []):
                if w in entries:
                    entries[w]["count"] += 5
                else:
                    entries[w] = {**_new_entry(), "count": 5}
            for w in data.get("abuse_vocab", []):
                profile["abuse_vocab"][w] += 5
            greeting = data.get("top_greeting")
            if greeting:
                profile["greeting_patterns"][greeting] += 5
            lang = data.get("dominant_language", "english")
            profile["language_mode_history"][lang] += 10
        except Exception:
            pass

    def should_save(self, user_id: str) -> bool:
        profile = self.get_profile(user_id)
        return profile.get("turns_since_save", 0) >= SAVE_EVERY_N_TURNS

    def reset_save_counter(self, user_id: str):
        self.get_profile(user_id)["turns_since_save"] = 0


# ─── Global singleton ─────────────────────────────────────────────────────────
# Redis/Supabase clients are injected at startup via vocab_learner.set_clients()

vocab_learner = VocabLearner()


def set_vocab_learner_clients(redis_client=None, supabase_client=None):
    """Call once at server startup after Redis/Supabase are initialized."""
    vocab_learner._redis = redis_client
    vocab_learner._supabase = supabase_client
