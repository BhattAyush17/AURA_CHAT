from sensing_engine import StateVector

DIRECTIVES = {
    "opening": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "gentle",
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
        "instruction": """
            The person is opening up and energy is rising.
            Match and slightly exceed their energy.
            Go deeper on whatever they bring.
            Be genuinely curious. This is real connection forming.
        """
    },
    "plateau_sustain": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "steady_warm",
        "instruction": "Sustain the current depth. Stay fully present."
    },
    "plateau_disrupt": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "curious_spike",
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
        "instruction": """
            There is friction present.
            Do not push or probe.
            Offer something soft — validate, acknowledge,
            or share something light.
            Create safety before anything else.
        """
    },
    "gentle_rekindle": {
        "injection_type": "passive",
        "length": "medium",
        "vocal_energy": "warm_gentle",
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
        "instruction": """
            They are pulling back. Do not chase.
            One warm sentence that leaves space.
            Let them come back at their own pace.
        """
    },
    "companion_burst": {
        "injection_type": "urgent",
        "length": "long",
        "vocal_energy": "warm_high",
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
        """
    },
    "presence": {
        "injection_type": "passive",
        "length": "very_short",
        "vocal_energy": "whisper_warm",
        "instruction": """
            The person has almost fully withdrawn.
            Do not perform. Do not try too hard.
            One quiet, genuine sentence.
            Like sitting beside someone in silence
            and simply letting them know you are still there.
        """
    },
}

def direct_response(state: StateVector) -> dict:
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
    else:
        return {"mode": "normal", "instruction": "", "vocal_energy": "adaptive", "length": "medium", "injection_type": "passive"}

    directive = DIRECTIVES[key].copy()
    directive["mode"] = key
    return directive
