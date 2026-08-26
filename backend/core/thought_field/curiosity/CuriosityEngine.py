from typing import Dict, List
import time

from .Curiosity import Curiosity
from .CuriosityState import CuriosityState
from .CuriositySource import CuriositySource
from .CuriosityPressure import CuriosityPressure
from .CuriosityNovelty import CuriosityNovelty
from .CuriosityUncertainty import CuriosityUncertainty
from .CuriosityGap import CuriosityGap
from .CuriosityPersistence import CuriosityPersistence
from .CuriosityDecay import CuriosityDecay

# Phase 5.10A stabilizers
from .CuriosityInertia import CuriosityInertia
from .CuriosityResilience import CuriosityResilience
from .CuriosityRecovery import CuriosityRecovery
from .CuriosityCompetition import CuriosityCompetition
from .CuriosityConvergence import CuriosityConvergence

# All upstream states are consumed READ ONLY
from ..predictive.PredictionState import PredictionState
from ..metacognition.MonitoringState import MonitoringState
from ..relationship.RelationshipState import RelationshipState
from ..goals.GoalState import GoalState
from ..habits.HabitState import HabitState
from ..values.ValueState import ValueState


class CuriosityEngine:
    """
    Canonical owner of AURA's intrinsic exploration pressure.

    ARCHITECTURAL INVARIANTS (Phase 5.10A)
    ───────────────────────────────────────
    CURIOSITY PRODUCES PRESSURE. NOT ACTION.
    - IdentityState is NEVER referenced.
    - Attention Gate is NEVER overridden.
    - All upstream states are READ ONLY.
    - No transcripts, prompts, or LLM output stored.
    - Single conversations cannot radically alter long-lived curiosity (inertia).
    - Temporary certainty cannot extinguish resilient curiosity (resilience).
    - Dormant curiosities recover faster than newly formed ones (recovery).
    - Multiple curiosities compete for pressure; none are deleted (competition).
    - Thematically adjacent weak curiosities can merge toward stronger ones (convergence).
    """

    def __init__(self):
        self.curiosities: Dict[str, Curiosity] = {}
        self._recurrence: Dict[str, int] = {}  # lifetime activation count per curiosity id

    # ──────────────────────────────────────────────────────────────────
    # Public API: submit structural evidence
    # ──────────────────────────────────────────────────────────────────

    def register_curiosity_signal(
        self,
        curiosity_id: str,
        theme: str,
        source: str,
        epistemic_uncertainty: float = 0.5,
        resolution_delta: float = 0.0,
        exposure_count: float = 0.0,
    ):
        """
        Register or update a curiosity with new structural evidence.
        Never receives raw text.
        """
        if curiosity_id not in self.curiosities:
            self.curiosities[curiosity_id] = Curiosity(
                id=curiosity_id,
                theme=theme,
                source=source,
            )
            self._recurrence[curiosity_id] = 0

        c = self.curiosities[curiosity_id]
        self._recurrence[curiosity_id] += 1

        if not hasattr(c, "_evidence"):
            c._evidence = {"uncertainty": epistemic_uncertainty,
                           "resolution_delta": 0.0,
                           "exposure": 0.0}

        c._evidence["uncertainty"]       = epistemic_uncertainty
        c._evidence["resolution_delta"] += resolution_delta
        c._evidence["exposure"]         += exposure_count
        c.last_activated = time.time()

    # ──────────────────────────────────────────────────────────────────
    # Core evolution tick
    # ──────────────────────────────────────────────────────────────────

    def experience(
        self,
        prediction_state: PredictionState,
        monitoring_state: MonitoringState,
        relationship_state: RelationshipState,
        goal_state: GoalState,
        habit_state: HabitState,
        value_state: ValueState,
    ) -> CuriosityState:
        """
        Evolves all curiosities and returns an immutable CuriosityState.
        All upstream states are READ ONLY.
        """
        # ── Global epistemic uncertainty from upstream states ─────────
        global_uncertainty = min(1.0, (
            monitoring_state.oscillation_index       * 0.40
            + (1.0 - prediction_state.prediction_confidence) * 0.40
            + monitoring_state.cognitive_fatigue     * 0.20
        ))

        dominant_value_strength = (value_state.active_values[0].strength
                                   if value_state.active_values else 0.3)
        dominant_goal_momentum  = (goal_state.active_goals[0].momentum
                                   if goal_state.active_goals else 0.3)

        # ── Per-curiosity evolution ──────────────────────────────────
        active_curiosities: List[Curiosity]   = []
        dormant_curiosities: List[Curiosity]  = []
        resolved_curiosities: List[Curiosity] = []
        extinct_curiosities: List[Curiosity]  = []

        for cid, c in self.curiosities.items():
            ev = getattr(c, "_evidence", {
                "uncertainty": global_uncertainty,
                "resolution_delta": 0.0,
                "exposure": 0.0,
            })

            local_uncertainty = (global_uncertainty * 0.5) + (ev["uncertainty"] * 0.5)
            recurrence_norm   = min(1.0, self._recurrence.get(cid, 0) / 20.0)

            # ── 1. Time-based decay ──────────────────────────────────
            prev_pressure = c.pressure
            c.pressure    = CuriosityDecay.apply(c)
            pressure_loss = max(0.0, prev_pressure - c.pressure)

            # ── 2. Uncertainty ───────────────────────────────────────
            # Certainty spike = how much uncertainty dropped this tick
            certainty_spike = max(0.0, c.uncertainty - local_uncertainty)
            c.uncertainty   = CuriosityUncertainty.evaluate(c, local_uncertainty)

            # ── 3. Novelty ───────────────────────────────────────────
            c.novelty = CuriosityNovelty.evaluate(c, ev["exposure"])

            # ── 4. Information gap ───────────────────────────────────
            if ev["resolution_delta"] > 0:
                c.resolution = CuriosityGap.apply_resolution(c, ev["resolution_delta"])

            # ── 5. Inertia (Phase 5.10A) ─────────────────────────────
            c.inertia = CuriosityInertia.evaluate(c, recurrence_norm)

            # ── 6. Resilience (Phase 5.10A) ──────────────────────────
            c.resilience = CuriosityResilience.evaluate(c, certainty_spike)

            # ── 7. Persistence ───────────────────────────────────────
            c.persistence = CuriosityPersistence.evaluate(
                c,
                goal_relevance=dominant_goal_momentum,
                value_alignment=dominant_value_strength,
                recurrence_signal=recurrence_norm,
            )

            # ── 8. Pressure (inertia-gated) ──────────────────────────
            raw_pressure = CuriosityPressure.evaluate(
                c,
                value_alignment=dominant_value_strength,
                goal_relevance=dominant_goal_momentum,
            )
            # Inertia slows how fast pressure can change in either direction
            pressure_delta     = raw_pressure - c.pressure
            effective_pressure = c.pressure + pressure_delta * (1.0 - c.inertia * 0.6)
            # Resilience protects pressure from dropping when certainty spikes
            if certainty_spike > 0.2:
                floor = c.pressure * c.resilience
                effective_pressure = max(effective_pressure, floor)
            c.pressure = max(0.0, min(1.0, effective_pressure))

            pressure_gain = max(0.0, c.pressure - prev_pressure)
            pressure_loss = max(0.0, prev_pressure - c.pressure)

            # ── 9. Recovery capacity (Phase 5.10A) ───────────────────
            c.recovery_capacity = CuriosityRecovery.evaluate(
                c,
                pressure_gain=pressure_gain,
                pressure_loss=pressure_loss,
                goal_relevance=dominant_goal_momentum,
                value_alignment=dominant_value_strength,
            )

            # ── 10. Confidence ────────────────────────────────────────
            c.confidence = min(0.95, c.confidence + (c.persistence * 0.1 - c.confidence * 0.05))

            # ── 11. Lifecycle ────────────────────────────────────────
            c.lifecycle_state = self._evaluate_lifecycle(c)

            # Clear evidence buffer
            c._evidence      = {"uncertainty": 0.0, "resolution_delta": 0.0, "exposure": 0.0}
            c.last_updated   = time.time()

            # ── Categorise ───────────────────────────────────────────
            ls = c.lifecycle_state
            if ls in ("SPARKING", "FORMING", "ACTIVE", "PERSISTENT", "SATISFYING"):
                active_curiosities.append(c)
            elif ls == "RESOLVED":
                resolved_curiosities.append(c)
            elif ls == "DORMANT":
                dormant_curiosities.append(c)
            elif ls == "EXTINCT":
                extinct_curiosities.append(c)

        # ── Phase 5.10A: Competition (pressure redistribution) ───────
        CuriosityCompetition.apply(active_curiosities)

        # ── Phase 5.10A: Convergence (thematic merging) ──────────────
        CuriosityConvergence.apply(self.curiosities)

        # ── Sort and package ─────────────────────────────────────────
        active_curiosities.sort(key=lambda x: x.pressure, reverse=True)

        total_pressure  = sum(c.pressure for c in active_curiosities)
        avg_novelty     = (sum(c.novelty     for c in active_curiosities) / len(active_curiosities)
                           if active_curiosities else 0.0)
        avg_uncertainty = (sum(c.uncertainty for c in active_curiosities) / len(active_curiosities)
                           if active_curiosities else 0.0)
        dominant_theme  = active_curiosities[0].theme if active_curiosities else ""

        return CuriosityState(
            active_curiosities=active_curiosities,
            dormant_curiosities=dormant_curiosities,
            resolved_curiosities=resolved_curiosities,
            extinct_curiosities=extinct_curiosities,
            dominant_curiosity_theme=dominant_theme,
            total_pressure=total_pressure,
            average_novelty=avg_novelty,
            average_uncertainty=avg_uncertainty,
        )

    # ──────────────────────────────────────────────────────────────────
    # Lifecycle evaluator
    # ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _evaluate_lifecycle(c: Curiosity) -> str:
        if c.lifecycle_state == "EXTINCT":
            return "EXTINCT"

        if c.resolution >= 0.95:
            if c.lifecycle_state != "RESOLVED":
                c.add_history("resolved", 1.0)
            return "RESOLVED"

        # Dormancy: only if pressure AND resilience are both very low
        if c.pressure < 0.05 and c.resilience < 0.2 and c.persistence < 0.2:
            elapsed = time.time() - c.last_activated
            if elapsed > 86400 * 30:
                c.add_history("extinct")
                return "EXTINCT"
            if c.lifecycle_state != "DORMANT":
                c.add_history("dormancy_entered")
            return "DORMANT"

        # Recovery: dormant curiosity regains pressure
        if c.lifecycle_state == "DORMANT" and c.pressure > 0.15:
            c.add_history("revived", c.pressure)
            return "FORMING"

        if c.pressure > 0.7 and c.persistence > 0.6:
            return "PERSISTENT"
        if c.resolution > 0.5 and c.pressure > 0.2:
            return "SATISFYING"
        if c.pressure > 0.4:
            return "ACTIVE"
        if c.pressure > 0.1 or c.confidence > 0.2:
            return "FORMING"
        return "SPARKING"
