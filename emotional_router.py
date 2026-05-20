from withdrawal_detector import compute_withdrawal_score, detect_language, build_withdrawal_prompt
from frustration_detector import compute_frustration_score, build_frustration_prompt
from dataclasses import dataclass, asdict
import re


# ═══════════════════════════════════════════════════════════════════
# EMOTION VECTOR — Composite multi-dimensional emotional state
# ═══════════════════════════════════════════════════════════════════

# Self-disclosure markers for vulnerability detection
_VULN_PATTERNS = re.compile(
    r"\b(i feel|i'm scared|i'm afraid|nobody understands|i can't|i don't know if|"
    r"it hurts|i'm lost|i'm alone|mujhe dar|mujhe lagta|koi nahi samajhta|"
    r"i hate myself|what's wrong with me|i'm worthless|nobody cares)\b",
    re.IGNORECASE,
)

# Humor / playfulness markers
_PLAY_PATTERNS = re.compile(
    r"\b(lol|haha|lmao|rofl|😂|🤣|just kidding|jk|bruh|bro chill|"
    r"mazaak|masti|chill|yaar|dude|lowkey|no cap|vibe|slay)\b",
    re.IGNORECASE,
)


@dataclass
class EmotionVector:
    """
    Weighted emotion vector. Humans feel multiple emotions simultaneously.
    Each dimension is 0.0–1.0. The `primary` property maintains backward
    compatibility with code that expects a single label.
    """
    frustration: float = 0.0
    withdrawal: float = 0.0
    engagement: float = 0.0
    vulnerability: float = 0.0
    playfulness: float = 0.0

    def _sorted_scores(self) -> list[tuple[str, float]]:
        scores = {
            "frustration": self.frustration,
            "withdrawal": self.withdrawal,
            "engagement": self.engagement,
            "vulnerability": self.vulnerability,
            "playfulness": self.playfulness,
        }
        return sorted(scores.items(), key=lambda x: x[1], reverse=True)

    def _values(self) -> list[float]:
        return [self.frustration, self.withdrawal, self.engagement,
                self.vulnerability, self.playfulness]

    @property
    def primary(self) -> str:
        """Backward-compatible: returns the dominant emotion label."""
        top = self._sorted_scores()
        # If nothing is significant, return 'normal'
        if top[0][1] < 0.2:
            return "normal"
        return top[0][0]

    @property
    def secondary(self) -> str | None:
        """Second strongest emotion, if significant (>0.3)."""
        scores = self._sorted_scores()
        if len(scores) > 1 and scores[1][1] > 0.3:
            return scores[1][0]
        return None

    @property
    def is_mixed(self) -> bool:
        """True if multiple emotions are significant (>0.3)."""
        return sum(1 for v in self._values() if v > 0.3) >= 2

    def to_compact(self) -> str:
        """For prompt injection: 'f0.6|w0.3|e0.1|v0.0|p0.0'"""
        return (
            f"f{self.frustration:.1f}|w{self.withdrawal:.1f}|"
            f"e{self.engagement:.1f}|v{self.vulnerability:.1f}|"
            f"p{self.playfulness:.1f}"
        )

    def to_dict(self) -> dict:
        return asdict(self)


# ═══════════════════════════════════════════════════════════════════
# EMOTIONAL STATE ROUTER
# ═══════════════════════════════════════════════════════════════════

class EmotionalStateRouter:
    """
    Runs all emotion detectors each turn and returns an EmotionVector
    with weighted scores across all dimensions.

    Backward-compatible: callers that only need a single label
    can use result.emotion_vector.primary or result['state'].
    """

    PRIORITY = ["frustration", "withdrawal"]

    def __init__(self):
        self.scores = {s: 0.0 for s in self.PRIORITY}
        self.active_state = "normal"
        self.language = "english"
        self.intensity = 0.0
        self.consecutive_low_turns = 0
        self.consecutive_boost_turns = 0
        self.boost_active = False

    # ── New scorers (engagement, vulnerability, playfulness) ─────

    def _score_engagement(self, turn_history: list, current_turn: dict) -> float:
        """
        Score engagement from response length, punctuation, and topic continuity.
        Range: 0.0 – 1.0.
        """
        text = current_turn.get("text", "")
        if not text:
            return 0.0

        score = 0.0
        word_count = len(text.split())

        # Length signal: longer responses = more engaged (capped at 0.3)
        score += min(0.3, word_count / 60)

        # Question marks: asking questions = engaged
        score += min(0.2, text.count("?") * 0.1)

        # Exclamation marks: emotional expression = engaged
        score += min(0.15, text.count("!") * 0.075)

        # Topic continuity: if user references something from last 3 turns
        if len(turn_history) >= 2:
            recent_words = set()
            for t in turn_history[-3:]:
                recent_words.update(t.get("text", "").lower().split())
            current_words = set(text.lower().split())
            overlap = len(current_words & recent_words)
            score += min(0.2, overlap / 20)

        # Multi-sentence bonus
        sentences = len(re.split(r'[.!?]+', text.strip()))
        if sentences >= 3:
            score += 0.15

        return min(1.0, score)

    def _score_vulnerability(self, current_turn: dict, trust: float = 0.3) -> float:
        """
        Score vulnerability from self-disclosure patterns.
        Low trust amplifies significance (vulnerability when trust is low = braver).
        Range: 0.0 – 1.0.
        """
        text = current_turn.get("text", "")
        if not text:
            return 0.0

        matches = len(_VULN_PATTERNS.findall(text))
        if matches == 0:
            return 0.0

        base = min(0.6, matches * 0.2)

        # Trust modifier: vulnerability at low trust is more significant
        trust_boost = max(0.0, (0.5 - trust) * 0.4)  # +0.2 at trust=0, 0 at trust>=0.5
        return min(1.0, base + trust_boost)

    def _score_playfulness(self, current_turn: dict) -> float:
        """
        Score playfulness from humor markers, slang density, and exaggeration.
        Range: 0.0 – 1.0.
        """
        text = current_turn.get("text", "")
        if not text:
            return 0.0

        matches = len(_PLAY_PATTERNS.findall(text))
        if matches == 0:
            return 0.0

        base = min(0.7, matches * 0.2)

        # Exaggeration (ALL CAPS words)
        caps_words = sum(1 for w in text.split() if w.isupper() and len(w) > 2)
        base += min(0.15, caps_words * 0.05)

        # Short + punchy = more playful
        if len(text.split()) < 10:
            base += 0.1

        return min(1.0, base)

    # ── Main resolver ────────────────────────────────────────────

    def resolve(self, turn_history: list, current_turn: dict,
                trust: float = 0.3) -> dict:
        """
        Run ALL detectors, return routing decision with EmotionVector.

        Backward-compatible: returned dict still has 'state', 'intensity',
        'all_scores' etc. New code can use 'emotion_vector'.
        """

        # Run existing detectors
        withdrawal_result = compute_withdrawal_score(turn_history + [current_turn])
        frustration_result = compute_frustration_score(turn_history + [current_turn])

        self.scores["withdrawal"] = withdrawal_result["score"]
        self.scores["frustration"] = frustration_result["score"]

        # Run new scorers
        engagement_score = self._score_engagement(turn_history, current_turn)
        vulnerability_score = self._score_vulnerability(current_turn, trust)
        playfulness_score = self._score_playfulness(current_turn)

        # Build composite vector
        emotion_vector = EmotionVector(
            frustration=frustration_result["score"],
            withdrawal=withdrawal_result["score"],
            engagement=engagement_score,
            vulnerability=vulnerability_score,
            playfulness=playfulness_score,
        )

        # Track consecutive low energy for Companion Boost
        if withdrawal_result["score"] >= 0.4:
            self.consecutive_low_turns += 1
        else:
            self.consecutive_low_turns = 0
            self.boost_active = False
            self.consecutive_boost_turns = 0

        # Detect language
        self.language = detect_language(current_turn.get("text", ""))

        # Backward-compat: single dominant state via priority
        dominant = "normal"
        intensity = 0.0

        for state in self.PRIORITY:
            if self.scores.get(state, 0.0) >= 0.3:
                dominant = state
                intensity = self.scores[state]
                break

        self.active_state = dominant
        self.intensity = intensity

        # Build prompt override (existing logic)
        override = self._build_override(dominant, intensity, self.language)

        display_state = "companion_boost" if self.boost_active else dominant

        return {
            "state": display_state,
            "intensity": intensity,
            "language": self.language,
            "prompt_override": override,
            "all_scores": {
                **self.scores.copy(),
                "engagement": engagement_score,
                "vulnerability": vulnerability_score,
                "playfulness": playfulness_score,
            },
            # New: composite emotion vector
            "emotion_vector": emotion_vector,
        }

    def _build_override(self, state: str, intensity: float, language: str) -> str:
        """Route to the correct prompt builder based on state."""

        if self.consecutive_low_turns >= 5:
            self.boost_active = True
            self.consecutive_boost_turns += 1
            if self.consecutive_boost_turns > 2:
                self.consecutive_low_turns = 0
                self.boost_active = False
                self.consecutive_boost_turns = 0
            else:
                return build_withdrawal_prompt("companion_boost", language)

        if state == "normal":
            return ""

        # Standard Intensity Mapping
        if intensity < 0.3:
            mode = "latent"
        elif intensity < 0.5:
            mode = "soft"
        elif intensity < 0.75:
            mode = "active"
        else:
            mode = "peak"

        if state == "withdrawal":
            return build_withdrawal_prompt(mode, language, exit_turn=0)

        elif state == "frustration":
            return build_frustration_prompt(mode, language)

        return ""
