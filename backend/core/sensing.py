import time
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, Literal, Optional

ArcState = Literal[
    "opening", "building", "plateau", 
    "declining", "withdrawing", "closed"
]

# ═══════════════════════════════════════════════════════════════════
# TEMPORAL DECAY CONFIGURATION
# ═══════════════════════════════════════════════════════════════════
# Each rate is the per-turn (30s) retention factor.
# value *= rate ^ (elapsed_seconds / 30)
#
# Emotion half-lives at these rates:
#   energy:  0.92 → half-life ≈ 4.1 turns (2 min)
#   warmth:  0.95 → half-life ≈ 6.6 turns (3.3 min)
#   trust:   0.97 → half-life ≈ 11.3 turns (5.6 min)
#   tension: 0.80 → half-life ≈ 1.5 turns (45 sec)

DECAY_RATES: Dict[str, float] = {
    "energy":  0.92,   # Moderate — energy is ephemeral
    "warmth":  0.95,   # Slow — warmth lingers between turns
    "trust":   0.97,   # Very slow — trust is hard-won, slow to fade
    "tension": 0.80,   # Fast — tension resolves quickly without reinforcement
}

# Normalize elapsed time to this many seconds per "decay unit".
# At 30s/turn, decay_units=1.0 per turn. During silence (60s gap),
# decay_units=2.0 → double decay. During rapid turns (10s), decay_units=0.33.
DECAY_NORM_SECONDS: float = 30.0


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
    # Temporal decay tracking
    last_update_timestamp: Optional[float] = None
    # Momentum: delta-of-deltas per dimension (emotional acceleration)
    momentum: Dict[str, float] = field(default_factory=lambda: {
        "energy": 0.0, "warmth": 0.0, "trust": 0.0, "tension": 0.0,
    })
    _prev_deltas: Dict[str, float] = field(default_factory=lambda: {
        "energy": 0.0, "warmth": 0.0, "trust": 0.0, "tension": 0.0,
    })

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

    # ───────────────────────────────────────────────────────────────
    # TEMPORAL DECAY
    # ───────────────────────────────────────────────────────────────

    def _apply_temporal_decay(self, now: Optional[float] = None) -> Dict[str, float]:
        """
        Decay all emotional dimensions based on elapsed wall-clock time.

        Returns a dict of {dimension: value_before_decay} for momentum calc.

        Idempotent: if now == last_update_timestamp, all multipliers = 1.0
        (rate ^ 0 = 1), so values are unchanged. Safe to call multiple times.
        """
        if now is None:
            now = time.time()

        pre_decay = {
            "energy": self.state.energy,
            "warmth": self.state.warmth,
            "trust": self.state.trust,
            "tension": self.state.tension,
            "engagement": self.state.engagement,
        }

        # First turn ever — no decay, just record timestamp
        if self.state.last_update_timestamp is None:
            self.state.last_update_timestamp = now
            return pre_decay

        elapsed = max(0.0, now - self.state.last_update_timestamp)
        if elapsed <= 0:
            return pre_decay  # Same timestamp — no decay (idempotent)

        decay_units = elapsed / DECAY_NORM_SECONDS

        for dim, rate in DECAY_RATES.items():
            current = getattr(self.state, dim)
            # Decay toward 0.0 (neutral). Tension fades fastest.
            decayed = current * (rate ** decay_units)
            setattr(self.state, dim, max(0.0, min(1.0, decayed)))

        # Engagement is derived from energy + warmth, so decay it proportionally
        eng_rate = (DECAY_RATES["energy"] + DECAY_RATES["warmth"]) / 2.0
        self.state.engagement = max(
            0.0, min(1.0, self.state.engagement * (eng_rate ** decay_units))
        )

        self.state.last_update_timestamp = now
        return pre_decay

    def decay_to_now(self) -> StateVector:
        """
        Apply temporal decay without any new turn input.

        Use this when checking emotional state during silence,
        proactive triggers, or the SilenceStateMachine tick.
        Safe to call repeatedly — idempotent by timestamp.
        """
        self._apply_temporal_decay()
        return self.state

    def get_dominant_emotion(self) -> str:
        """
        Return the dimension with the highest absolute value.

        Useful for quick emotional classification in logs,
        the /health endpoint, or the ResponseDirector.
        """
        dims = {
            "energy": self.state.energy,
            "warmth": self.state.warmth,
            "trust": self.state.trust,
            "tension": self.state.tension,
            "engagement": self.state.engagement,
        }
        return max(dims, key=dims.get)

    def ingest(self, turn: dict) -> StateVector:
        now = time.time()
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

        # ── Step 0: Apply temporal decay BEFORE new deltas ──────────
        # Snapshot pre-decay values for momentum calculation
        pre_decay = self._apply_temporal_decay(now)

        # ── Step 1: Energy — acoustic + verbal + temporal ──────────
        rms_score = min(rms / 0.08, 1.0)
        word_score = min(words / 20.0, 1.0)
        pause_score = max(0.0, 1.0 - pause_ms / 3000.0)
        raw_energy = rms_score * 0.4 + word_score * 0.4 + pause_score * 0.2
        self.state.energy = self.state.energy * 0.6 + raw_energy * 0.4
        self.state.energy_delta = self.state.energy - self._prev_energy
        self._prev_energy = self.state.energy

        # ── Step 2: Warmth — inverse of negative signals ───────────
        raw_warmth = max(0.0, 1.0 - frustration * 0.6 - withdrawal * 0.4)
        self.state.warmth = self.state.warmth * 0.7 + raw_warmth * 0.3

        # ── Step 3: Engagement — blend of energy and warmth ────────
        raw_engagement = self.state.energy * 0.5 + self.state.warmth * 0.5
        self.state.engagement_delta = raw_engagement - pre_decay["engagement"]
        self.state.engagement = self.state.engagement * 0.65 + raw_engagement * 0.35
        self._prev_engagement = self.state.engagement

        # ── Step 4: Trust — builds slowly, drops on frustration ────
        apology_hit = any(tok in turn.get("text", "").lower() for tok in ["sorry", "apologize", "my bad", "maaf", "maafi"])
        
        if frustration > 0.6:
            self.state.trust = max(0.0, self.state.trust - 0.05)
        elif apology_hit:
            self.state.trust = min(1.0, self.state.trust + 0.10)
        elif self.state.engagement > 0.6:
            self.state.trust = min(1.0, self.state.trust + 0.02)

        # ── Step 5: Tension — spikes on frustration, fades naturally
        if frustration > 0.5:
            spike_amount = 0.15 + (frustration - 0.5) * 1.5
            self.state.tension = min(1.0, self.state.tension + spike_amount)
        elif apology_hit:
            self.state.tension = max(0.0, self.state.tension * 0.50)  # Halve tension instantly on apology!
        else:
            self.state.tension = max(0.0, self.state.tension * 0.85)

        # ── Clamp all values to [0.0, 1.0] ─────────────────────────
        for dim in ("energy", "warmth", "engagement", "trust", "tension"):
            val = getattr(self.state, dim)
            setattr(self.state, dim, max(0.0, min(1.0, val)))

        # ── Momentum: delta-of-deltas (emotional acceleration) ─────
        current_deltas = {
            "energy":  self.state.energy - pre_decay["energy"],
            "warmth":  self.state.warmth - pre_decay["warmth"],
            "trust":   self.state.trust - pre_decay["trust"],
            "tension": self.state.tension - pre_decay["tension"],
        }
        self.state.momentum = {
            dim: round(current_deltas[dim] - self.state._prev_deltas.get(dim, 0.0), 4)
            for dim in current_deltas
        }
        self.state._prev_deltas = current_deltas

        # ── Acoustics ──────────────────────────────────────────────
        self.state.avg_rms = avg_rms
        self.state.rms_trend = rms_trend
        self.state.avg_pause_ms = avg_pause

        # ── Peak tracking ──────────────────────────────────────────
        if self.state.energy > 0.75:
            self.state.peak_reached = True

        # ── Arc ────────────────────────────────────────────────────
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
    """Serialize StateVector to seed format. Excludes transient fields
    (timestamp, momentum, prev_deltas) — those are session-scoped only."""
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


# ═══════════════════════════════════════════════════════════════════
# TEST SUGGESTIONS
# ═══════════════════════════════════════════════════════════════════
#
# 1. test_decay_idempotent:
#    engine.ingest(turn1)
#    state1 = copy(engine.state)
#    engine.decay_to_now()  # immediately — elapsed ≈ 0
#    assert state1.energy == engine.state.energy  # no extra decay
#
# 2. test_tension_half_life:
#    engine.state.tension = 0.8
#    engine.state.last_update_timestamp = time.time() - 45  # 1.5 turns
#    engine.decay_to_now()
#    assert 0.35 < engine.state.tension < 0.45  # ~half of 0.8
#
# 3. test_trust_slow_decay:
#    engine.state.trust = 0.8
#    engine.state.last_update_timestamp = time.time() - 60  # 2 turns
#    engine.decay_to_now()
#    assert engine.state.trust > 0.7  # trust barely moved
#
# 4. test_long_silence_decay:
#    engine.state.energy = 0.9
#    engine.state.last_update_timestamp = time.time() - 300  # 5 min
#    engine.decay_to_now()
#    assert engine.state.energy < 0.3  # energy fully faded
#
# 5. test_momentum_direction:
#    engine.ingest(turn_frustrated)  # tension spikes
#    engine.ingest(turn_neutral)     # tension eases
#    assert engine.state.momentum["tension"] < 0  # decelerating
#
# 6. test_seed_roundtrip:
#    seed = summarize_arc_for_seed(engine.state)
#    engine2 = SensingEngine(previous_seed=seed)
#    assert engine2.state.trust == approx(engine.state.trust, abs=0.1)
#    assert engine2.state.last_update_timestamp is None  # not serialized
#
# 7. test_get_dominant_emotion:
#    engine.state.tension = 0.9
#    engine.state.energy = 0.3
#    assert engine.get_dominant_emotion() == "tension"
