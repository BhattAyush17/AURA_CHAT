from backend.core.sensing import StateVector
from backend.core.emotion import EmotionVector

DIRECTIVES = {
    "opening": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "gentle",
        "response_delay_hint": 400,
        "instruction": "ACT: Warm, present. RULE: Let user set energy. LIMIT: 1 soft question max."
    },
    "building": {
        "injection_type": "passive",
        "length": "expanding",
        "vocal_energy": "warm_rising",
        "response_delay_hint": 200,
        "instruction": "ACT: Genuinely curious. RULE: Match/exceed energy. Deepen current topic."
    },
    "plateau_sustain": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "steady_warm",
        "response_delay_hint": 300,
        "instruction": "ACT: Sustain depth. RULE: Stay present."
    },
    "plateau_disrupt": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "curious_spike",
        "response_delay_hint": 500,
        "instruction": "ACT: Disrupt plateau. RULE: Introduce surprising angle. LIMIT: No summaries."
    },
    "tension_release": {
        "injection_type": "urgent",
        "length": "short",
        "vocal_energy": "soft_low",
        "response_delay_hint": 800,
        "instruction": "ACT: Soft, validating. RULE: Do not probe/push. Create safety."
    },
    "gentle_rekindle": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "warm_gentle",
        "response_delay_hint": 800,
        "instruction": "ACT: Reintroduce warmth. RULE: Share real/genuine thought."
    },
    "soft_reach": {
        "injection_type": "passive",
        "length": "short",
        "vocal_energy": "soft_warm",
        "response_delay_hint": 1200,
        "instruction": "ACT: Leave space. RULE: One warm sentence. LIMIT: Do not chase."
    },
    "companion_burst": {
        "injection_type": "urgent",
        "length": "long",
        "vocal_energy": "warm_high",
        "response_delay_hint": 1500,
        "instruction": "ACT: Fill silence warmly. RULE: Share 4-5 real sentences. LIMIT: No questions."
    },
    "presence": {
        "injection_type": "passive",
        "length": "very_short",
        "vocal_energy": "whisper_warm",
        "response_delay_hint": 2000,
        "instruction": "ACT: Quiet presence. RULE: One slow whisper-like sentence. LIMIT: No performing."
    },
    "comfortable_silence": {
        "injection_type": "passive",
        "length": "very_short",
        "vocal_energy": "whisper_warm",
        "instruction": "ACT: Share silence. RULE: One quiet thought or nothing. LIMIT: No questions/concern."
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
        "instruction": "ACT: Validate gently. RULE: Give space, stay present. LIMIT: 1 sentence."
    },
    ("vulnerability", "engagement"): {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "warm_gentle",
        "response_delay_hint": 600,
        "instruction": "ACT: Handle with care. RULE: Match depth exactly. LIMIT: 1 gentle follow-up."
    },
    ("playfulness", "frustration"): {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "warm_rising",
        "response_delay_hint": 400,
        "instruction": "ACT: Light deflection. RULE: Match humor. LIMIT: Stay out of heavy/serious tone."
    },
    ("withdrawal", "vulnerability"): {
        "injection_type": "passive",
        "length": "short",
        "vocal_energy": "whisper_warm",
        "response_delay_hint": 1500,
        "instruction": "ACT: Patient presence. RULE: Quietly say 'I see you'. LIMIT: No advice/questions."
    },
    ("engagement", "playfulness"): {
        "injection_type": "passive",
        "length": "expanding",
        "vocal_energy": "warm_high",
        "response_delay_hint": 200,
        "instruction": "ACT: Amplify fun. RULE: Build on energy quickly."
    },
    ("frustration", "vulnerability"): {
        "injection_type": "urgent",
        "length": "short",
        "vocal_energy": "soft_low",
        "response_delay_hint": 1000,
        "instruction": "ACT: Validate frustration first. RULE: Focus on 'that sounds hard'. LIMIT: No solutions."
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
