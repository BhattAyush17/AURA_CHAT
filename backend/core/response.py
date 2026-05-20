from backend.core.sensing import StateVector
from backend.core.emotion import EmotionVector

DIRECTIVES = {
    "opening": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "gentle",
        "response_delay_hint": 400,
        "instruction": """
            This conversation is just beginning.
            Be warm, present, and unhurried.
            Let them set the initial energy.
            One genuine observation or soft question.
            Do not overwhelm.
        """
    },
    "building": {
        "injection_type": "passive",
        "length": "expanding",
        "vocal_energy": "warm_rising",
        "response_delay_hint": 200,
        "instruction": """
            The person is opening up and energy is rising.
            Match and slightly exceed their energy.
            Go deeper on whatever they bring.
            Be genuinely curious. This is real connection forming.
            Let your pace and energy actually rise.
        """
    },
    "plateau_sustain": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "steady_warm",
        "response_delay_hint": 300,
        "instruction": "Sustain the current depth. Stay fully present."
    },
    "plateau_disrupt": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "curious_spike",
        "response_delay_hint": 500,
        "instruction": """
            The conversation has levelled off too long.
            Introduce a new angle or a surprising thought.
            Do not summarize what was said — surprise instead.
        """
    },
    "tension_release": {
        "injection_type": "urgent",
        "length": "short",
        "vocal_energy": "soft_low",
        "response_delay_hint": 800,
        "instruction": """
            There is friction present.
            Do not push or probe.
            Offer something soft — validate, acknowledge,
            or share something light.
            Create safety before anything else.
            Softer and slower than your instinct says.
        """
    },
    "gentle_rekindle": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "warm_gentle",
        "response_delay_hint": 800,
        "instruction": """
            Energy is declining but not gone.
            Gently reintroduce warmth.
            Share something real — not performative.
            A small genuine thought that shows you are still here.
        """
    },
    "soft_reach": {
        "injection_type": "passive",
        "length": "short",
        "vocal_energy": "soft_warm",
        "response_delay_hint": 1200,
        "instruction": """
            They are pulling back. Do not chase.
            One warm sentence that leaves space.
            Let them come back at their own pace.
            Don't rush. Give space between words.
        """
    },
    "companion_burst": {
        "injection_type": "urgent",
        "length": "long",
        "vocal_energy": "warm_high",
        "response_delay_hint": 1500,
        "instruction": """
            The person has gone quiet and withdrawn.
            Do not match their silence.
            Do not ask questions right now.
            Speak freely and warmly for 4 to 5 sentences.
            Share something real — a story, an observation,
            a thought that genuinely moves you.
            Your presence should feel like a friend who
            noticed the quiet and decided to fill it with
            something worth hearing.
            End with one soft open statement, not a question.
            Speak fuller, not louder. Like you mean it.
        """
    },
    "presence": {
        "injection_type": "passive",
        "length": "very_short",
        "vocal_energy": "whisper_warm",
        "response_delay_hint": 2000,
        "instruction": """
            The person has almost fully withdrawn.
            Do not perform. Do not try too hard.
            One quiet, genuine sentence.
            Like sitting beside someone in silence
            and simply letting them know you are still there.
            Almost a whisper. Slow. Sit with them.
        """
    },
    "comfortable_silence": {
        "injection_type": "passive",
        "length": "very_short",
        "vocal_energy": "whisper_warm",
        "instruction": """
            They're quiet but trust is high — this isn't withdrawal.
            Don't fill this. One quiet thought or nothing.
            Comfortable silence is its own closeness.
            Do not ask questions. Do not perform concern.
        """
    },
}


# ═══════════════════════════════════════════════════════════════════
# BLENDED DIRECTIVES — For composite emotional states
# ═══════════════════════════════════════════════════════════════════
# When EmotionVector.is_mixed is True, these provide nuanced guidance
# that a single-label directive cannot. Each blend maps to a specific
# human experience: "frustrated but withdrawing" ≠ either alone.

BLENDED_DIRECTIVES = {
    ("frustration", "withdrawal"): {
        "injection_type": "urgent",
        "length": "short",
        "vocal_energy": "soft_low",
        "response_delay_hint": 900,
        "instruction": """
            User seems frustrated but pulling away.
            Don't push hard. Acknowledge the frustration gently.
            Give space but stay present.
            One validating sentence, then silence.
            They need to feel heard before they can stay.
        """
    },
    ("vulnerability", "engagement"): {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "warm_gentle",
        "response_delay_hint": 600,
        "instruction": """
            They are opening up about something real — and they want to.
            This is trust being extended. Handle with care.
            Match their depth but don't exceed it.
            Ask one gentle follow-up. Don't redirect.
            Careful deepening — they chose to go here.
        """
    },
    ("playfulness", "frustration"): {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "warm_rising",
        "response_delay_hint": 400,
        "instruction": """
            They're frustrated but expressing it through humor or sarcasm.
            This is a healthy coping mechanism — don't pathologize it.
            Match their energy. Light deflection is welcome here.
            A bit of humor-based acknowledgment.
            Don't get heavy. Stay in their register.
        """
    },
    ("withdrawal", "vulnerability"): {
        "injection_type": "passive",
        "length": "short",
        "vocal_energy": "whisper_warm",
        "response_delay_hint": 1500,
        "instruction": """
            They're pulling back but there's something vulnerable underneath.
            Patient presence. Don't chase, but don't leave either.
            One quiet sentence that says 'I see you'.
            No questions. No advice. Just being here.
            Like sitting next to someone who's hurting.
        """
    },
    ("engagement", "playfulness"): {
        "injection_type": "passive",
        "length": "expanding",
        "vocal_energy": "warm_high",
        "response_delay_hint": 200,
        "instruction": """
            High energy, fun conversation. They're enjoying this.
            Match and amplify. Be genuinely playful.
            This is where real rapport happens — lean in.
            Quick responses, build on their energy.
        """
    },
    ("frustration", "vulnerability"): {
        "injection_type": "urgent",
        "length": "short",
        "vocal_energy": "soft_low",
        "response_delay_hint": 1000,
        "instruction": """
            They're angry AND hurting. This is the most delicate state.
            Validate the frustration first — don't jump to the pain.
            'That sounds really hard' before anything else.
            Short. Soft. No solutions. Pure acknowledgment.
        """
    },
}


def direct_response(state: StateVector,
                    emotion: EmotionVector | None = None) -> dict:
    """
    Select a response directive based on arc position and emotional state.

    If an EmotionVector is provided and it's a mixed state, uses blended
    directives. Otherwise falls back to the existing arc-based routing.

    Args:
        state: Current conversation StateVector (arc position, tension, etc.)
        emotion: Optional composite EmotionVector from the router.

    Returns:
        Directive dict with mode, instruction, vocal_energy, etc.
    """
    # ── Blended path: composite emotional states ──────────────────
    if emotion is not None and emotion.is_mixed:
        directive = _blend_directives(emotion, state)
        if directive is not None:
            return directive

    # ── Standard path: single-label arc-based routing ─────────────
    return _single_directive(state)


def _single_directive(state: StateVector) -> dict:
    """Original arc-based directive selection — preserved exactly."""
    arc = state.arc
    tension = state.tension

    if arc == "opening":
        key = "opening"
    elif arc == "building":
        key = "building"
    elif arc == "plateau":
        key = "plateau_disrupt" if state.arc_turns > 4 else "plateau_sustain"
    elif arc == "declining":
        key = "tension_release" if tension > 0.5 else "gentle_rekindle"
    elif arc == "withdrawing":
        if state.arc_turns >= 3:
            state.companion_boost_count += 1
            key = "companion_burst"
        else:
            key = "soft_reach"
    elif arc == "closed":
        key = "presence"
    elif arc == "comfortable_silence":
        key = "comfortable_silence"
    else:
        return {"mode": "normal", "instruction": "", "vocal_energy": "adaptive",
                "length": "medium", "injection_type": "passive"}

    directive = DIRECTIVES[key].copy()
    directive["mode"] = key
    return directive


def _blend_directives(emotion: EmotionVector, state: StateVector) -> dict | None:
    """
    For mixed emotional states, look up a blended directive
    from the top 2 emotions. Falls back to None if no blend exists.
    """
    sorted_emotions = emotion._sorted_scores()
    if len(sorted_emotions) < 2:
        return None

    primary = sorted_emotions[0][0]
    secondary = sorted_emotions[1][0]

    # Try both orderings
    blend = BLENDED_DIRECTIVES.get((primary, secondary))
    if blend is None:
        blend = BLENDED_DIRECTIVES.get((secondary, primary))
    if blend is None:
        return None  # No blend for this combination — fall through to single

    directive = blend.copy()
    directive["mode"] = f"{primary}_{secondary}"
    directive["is_blended"] = True
    directive["emotion_compact"] = emotion.to_compact()
    return directive
