"""
Component 4: Conversation Context Layer

Classifies the current interaction into conversation modes
and provides patience multipliers for downstream engines.
"""

from enum import Enum
from dataclasses import dataclass
import re
from typing import Optional


class ConversationMode(Enum):
    COMMAND = "command"
    QUESTION = "question"
    DISCUSSION = "discussion"
    STORYTELLING = "storytelling"
    EMOTIONAL = "emotional"
    REFLECTIVE = "reflective"


@dataclass
class ContextSignals:
    """Signals from the broader AURA pipeline."""
    emotional_intensity: float = 0.0
    tension: float = 0.0
    trust: float = 0.3
    arc_state: str = "opening"
    user_word_count: int = 0
    turn_number: int = 0
    storytelling_score: float = 0.3


_PATIENCE: dict = {
    ConversationMode.COMMAND:      0.5,
    ConversationMode.QUESTION:     0.65,
    ConversationMode.DISCUSSION:   1.0,
    ConversationMode.STORYTELLING: 1.5,
    ConversationMode.EMOTIONAL:    1.8,
    ConversationMode.REFLECTIVE:   1.8,
}

_CMD = re.compile(
    r"^(stop|play|pause|skip|next|open|close|set|turn|switch|"
    r"show|hide|mute|unmute|volume|timer|remind|alarm|call|"
    r"send|cancel|delete|undo|search|find|go to)\b", re.I
)
_QST = re.compile(
    r"^(what|who|where|when|why|how|is|are|do|does|did|can|"
    r"could|would|should|will|shall|have|has|had)\b", re.I
)
_EMO = re.compile(
    r"\b(feel|feeling|felt|hurts?|miss|scared|afraid|anxious|"
    r"worried|sad|happy|angry|frustrated|lonely|love|hate|"
    r"depressed|overwhelmed|stressed|lost|confused|broken|"
    r"grateful|sorry|forgive|cry|crying|tears|painful)\b", re.I
)
_REF = re.compile(
    r"\b(wonder|thinking about|reflect|contemplate|realize|"
    r"meaning|purpose|life|death|existence|regret|remember when|"
    r"used to|back then|years ago|growing up|believe|soul)\b", re.I
)
_STORY = re.compile(
    r"\b(so basically|let me tell you|you know what happened|"
    r"this one time|i was at|and then|so we|after that|"
    r"long story|funny thing|get this|picture this)\b", re.I
)


class ConversationContextLayer:
    """Stateless per-utterance conversation mode classifier."""

    def classify(
        self, text: str, signals: Optional[ContextSignals] = None
    ) -> ConversationMode:
        if signals is None:
            signals = ContextSignals()
        t = text.strip()

        emo_hits = len(_EMO.findall(t))
        if emo_hits >= 2 or (emo_hits >= 1 and signals.emotional_intensity > 0.6):
            return ConversationMode.EMOTIONAL
        if signals.tension > 0.7 and signals.emotional_intensity > 0.5:
            return ConversationMode.EMOTIONAL
        if _REF.search(t):
            return ConversationMode.REFLECTIVE
        if _CMD.match(t) and signals.user_word_count <= 8:
            return ConversationMode.COMMAND
        if _STORY.search(t):
            return ConversationMode.STORYTELLING
        if signals.user_word_count > 25 and signals.storytelling_score > 0.5:
            return ConversationMode.STORYTELLING
        if _QST.match(t) or t.endswith("?"):
            return ConversationMode.QUESTION
        return ConversationMode.DISCUSSION

    def get_patience_multiplier(self, mode: ConversationMode) -> float:
        return _PATIENCE.get(mode, 1.0)

    def get_base_delay_ms(self, mode: ConversationMode) -> int:
        return {
            ConversationMode.COMMAND: 100,
            ConversationMode.QUESTION: 150,
            ConversationMode.DISCUSSION: 250,
            ConversationMode.STORYTELLING: 350,
            ConversationMode.EMOTIONAL: 500,
            ConversationMode.REFLECTIVE: 500,
        }.get(mode, 250)
