import time
from collections import deque
from dataclasses import dataclass, field
from typing import Literal

ArcState = Literal[
    "opening", "building", "plateau", 
    "declining", "withdrawing", "closed"
]

@dataclass
class StateVector:
    energy: float = 0.5
    warmth: float = 0.5
    engagement: float = 0.5
    tension: float = 0.0
    trust: float = 0.3
    energy_delta: float = 0.0
    engagement_delta: float = 0.0
    arc: ArcState = "opening"
    arc_turns: int = 0
    session_turn: int = 0
    avg_rms: float = 0.0
    rms_trend: float = 0.0
    avg_pause_ms: float = 0.0
    companion_boost_count: int = 0
    total_withdrawals: int = 0
    peak_reached: bool = False

def parse_relational_memory(seed: str) -> dict:
    defaults = {
        "trust": 0.3,
        "energy": 0.5,
        "arc": "opening",
        "boosts": 0,
        "withdrawals": 0,
        "peak": False
    }
    try:
        start = seed.index("[RM]") + 4
        end = seed.index("[/RM]")
        block = seed[start:end].strip()
        for pair in block.split():
            key, val = pair.split(":")
            if key in ("trust", "energy"):
                defaults[key] = float(val)
            elif key in ("boosts", "withdrawals"):
                defaults[key] = int(val)
            elif key == "arc":
                defaults[key] = val
            elif key == "peak":
                defaults[key] = val == "true"
    except (ValueError, KeyError):
        pass
    return defaults

class SensingEngine:
    def __init__(self, previous_seed: str = ""):
        self.state = StateVector()
        self.rms_history = deque(maxlen=5)
        self.word_history = deque(maxlen=5)
        self.pause_history = deque(maxlen=5)
        self._prev_energy = 0.5
        self._prev_engagement = 0.5

        # Rehydrate relational memory from previous seed
        if previous_seed:
            rm = parse_relational_memory(previous_seed)
            prev_arc = rm.get("arc", "opening")

            # Gap 6: If last session ended heavy, start softer
            if prev_arc in ("withdrawing", "closed", "declining"):
                self.state.energy = 0.35
                self.state.warmth = 0.65
                self.state.engagement = 0.4
            else:
                self.state.energy = 0.5
                self.state.warmth = 0.5
                self.state.engagement = 0.5

            # Trust and tension carry over as before
            prev_trust = rm.get("trust", 0.3)
            self.state.trust = max(0.3, prev_trust * 0.8)
            self.state.tension = 0.0
            self.state.arc = "opening"
            self.state.arc_turns = 0

    def ingest(self, turn: dict) -> StateVector:
        words = len(turn.get("text", "").split())
        rms = float(turn.get("audio_rms") or self.state.avg_rms or 0.04)
        pause_ms = float(turn.get("pause_ms") or self.state.avg_pause_ms or 500)
        frustration = float(turn.get("frustration_score", 0.0))
        withdrawal = float(turn.get("withdrawal_score", 0.0))

        self.rms_history.append(rms)
        self.word_history.append(words)
        self.pause_history.append(pause_ms)

        avg_rms = sum(self.rms_history) / len(self.rms_history)
        avg_words = sum(self.word_history) / len(self.word_history)
        avg_pause = sum(self.pause_history) / len(self.pause_history)
        rms_trend = (
            self.rms_history[-1] - self.rms_history[0]
            if len(self.rms_history) >= 2 else 0.0
        )

        # Energy — acoustic + verbal + temporal
        rms_score = min(rms / 0.08, 1.0)
        word_score = min(words / 20.0, 1.0)
        pause_score = max(0.0, 1.0 - pause_ms / 3000.0)
        raw_energy = rms_score * 0.4 + word_score * 0.4 + pause_score * 0.2
        self.state.energy = self.state.energy * 0.6 + raw_energy * 0.4
        self.state.energy_delta = self.state.energy - self._prev_energy
        self._prev_energy = self.state.energy

        # Warmth — inverse of negative signals
        raw_warmth = max(0.0, 1.0 - frustration * 0.6 - withdrawal * 0.4)
        self.state.warmth = self.state.warmth * 0.7 + raw_warmth * 0.3

        # Engagement — blend of energy and warmth
        raw_engagement = self.state.energy * 0.5 + self.state.warmth * 0.5
        self.state.engagement_delta = raw_engagement - self.state.engagement
        self.state.engagement = self.state.engagement * 0.65 + raw_engagement * 0.35
        self._prev_engagement = self.state.engagement

        # Trust — builds slowly, drops on frustration
        if frustration > 0.6:
            self.state.trust = max(0.0, self.state.trust - 0.05)
        elif self.state.engagement > 0.6:
            self.state.trust = min(1.0, self.state.trust + 0.02)

        # Tension — spikes on frustration, fades naturally
        if frustration > 0.5:
            self.state.tension = min(1.0, self.state.tension + 0.15)
        else:
            self.state.tension = max(0.0, self.state.tension * 0.85)

        # Acoustics
        self.state.avg_rms = avg_rms
        self.state.rms_trend = rms_trend
        self.state.avg_pause_ms = avg_pause

        # Peak tracking
        if self.state.energy > 0.75:
            self.state.peak_reached = True

        # Arc
        self.state.session_turn += 1
        self.state.arc_turns += 1
        self._resolve_arc()

        return self.state

    def _resolve_arc(self):
        s = self.state
        prev = s.arc

        if s.session_turn <= 2:
            new_arc = "opening"
        elif s.engagement > 0.7 and s.energy_delta > 0.02:
            new_arc = "building"
        elif s.engagement > 0.65 and abs(s.energy_delta) < 0.05:
            new_arc = "plateau"
        elif s.engagement_delta < -0.05 and s.energy > 0.3:
            new_arc = "declining"
        elif (s.energy < 0.25 
              and s.engagement < 0.3 
              and s.trust > 0.6):
            new_arc = "comfortable_silence"
        elif s.energy < 0.25 and s.engagement < 0.3:
            new_arc = "withdrawing"
        elif s.energy < 0.15 and s.engagement < 0.2:
            new_arc = "closed"
        else:
            new_arc = prev

        MIN_ARC_HOLD = 2

        # Oscillation guard — hold arc for minimum turns before allowing change
        if new_arc != prev and s.arc_turns < MIN_ARC_HOLD and s.session_turn > 2:
            new_arc = prev

        if new_arc != prev:
            s.arc_turns = 0
            if new_arc == "withdrawing":
                s.total_withdrawals += 1
        
        s.arc = new_arc

def summarize_arc_for_seed(state: StateVector) -> str:
    return (
        f"[RM] "
        f"trust:{round(state.trust, 2)} "
        f"energy:{round(state.avg_rms, 3)} "
        f"arc:{state.arc} "
        f"boosts:{state.companion_boost_count} "
        f"withdrawals:{state.total_withdrawals} "
        f"peak:{'true' if state.peak_reached else 'false'} "
        f"[/RM]"
    )
