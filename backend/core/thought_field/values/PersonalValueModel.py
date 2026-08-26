from typing import Dict, List
import time

from .Value import Value
from .ValueState import ValueState
from .ValueFormation import ValueFormation
from .ValueStrength import ValueStrength
from .ValueConfidence import ValueConfidence
from .ValueSalience import ValueSalience
from .ValueStability import ValueStability
from .ValueConflict import ValueConflict
from .ValueDrift import ValueDrift
from .ValueInertia import ValueInertia
from .ValueResilience import ValueResilience
from .ValueRecovery import ValueRecovery
from .ValueHierarchy import ValueHierarchy
from .ValueConvergence import ValueConvergence

# Subsystem states consumed READ ONLY
from ..relationship.RelationshipState import RelationshipState
from ..goals.GoalState import GoalState
from ..habits.HabitState import HabitState
from ..predictive.PredictionState import PredictionState


class PersonalValueModel:
    """
    Canonical owner of AURA's long-term value structure.

    ARCHITECTURAL INVARIANT — VALUES ARE EVIDENCE, NOT IDENTITY
    ─────────────────────────────────────────────────────────────
    This subsystem models *what consistently appears to matter*.
    It MUST NEVER infer personality labels or identity conclusions.
    Only downstream Identity Evolution synthesises identity from values.

    Phase 5.9A hardening:
    - Every value has independent Inertia, Resilience, and Recovery.
    - Cross-subsystem Convergence replaces the flat agreement scalar.
    - ValueHierarchy propagates fractional salience boosts to child values.
    - Evidence context is preserved until after salience is computed so
      contextual relevance is not lost when ev is cleared.
    """

    def __init__(self):
        self.values: Dict[str, Value] = {}
        self.hierarchy = ValueHierarchy()

    # ──────────────────────────────────────────────────────────────────
    # Public API for upstream evidence submission
    # ──────────────────────────────────────────────────────────────────

    def add_or_update_value_evidence(
        self,
        value_id: str,
        theme: str,
        reinforcement_signal: float = 0.0,
        contradiction_signal: float = 0.0,
        contextual_relevance: float = 0.0,
        consistency_signal: float = 0.0,
        thematic_shift_signal: float = 0.0,
    ):
        """
        Receives structural evidence vectors from upstream subsystems.
        Never processes raw text.
        cross_subsystem_agreement is now computed internally via ValueConvergence.
        """
        if value_id not in self.values:
            self.values[value_id] = Value(id=value_id, theme=theme)

        value = self.values[value_id]

        if not hasattr(value, "_evidence"):
            value._evidence = {
                "reinf": 0.0, "contra": 0.0, "ctx": 0.0, "cons": 0.0, "shift": 0.0,
            }

        value._evidence["reinf"]  += reinforcement_signal
        value._evidence["contra"] += contradiction_signal
        value._evidence["ctx"]    += contextual_relevance
        value._evidence["cons"]   += consistency_signal
        value._evidence["shift"]  += thematic_shift_signal

        if reinforcement_signal > 0 or contextual_relevance > 0:
            value.last_observed = time.time()

    def declare_hierarchy(self, parent_id: str, child_id: str):
        """Registers a lightweight influence relationship between two values."""
        self.hierarchy.add_influence(parent_id, child_id)

    # ──────────────────────────────────────────────────────────────────
    # Core evolution tick
    # ──────────────────────────────────────────────────────────────────

    def experience(
        self,
        relationship_state: RelationshipState,
        goal_state: GoalState,
        habit_state: HabitState,
        prediction_state: PredictionState,
        tension_signal: float = 0.0,
    ) -> ValueState:
        """
        Evolves all values based on accumulated evidence and elapsed time.
        All upstream states are consumed READ ONLY.
        """
        active_values: List[Value] = []
        dormant_values: List[Value] = []
        extinct_values: List[Value] = []

        for value_id, value in self.values.items():
            ev = getattr(value, "_evidence", {
                "reinf": 0.0, "contra": 0.0, "ctx": 0.0, "cons": 0.0, "shift": 0.0,
            })

            # ── 1. Consistency (smoothed) ────────────────────────────
            if ev["cons"] > 0:
                value.consistency = value.consistency + (ev["cons"] - value.consistency) * 0.1

            # ── 2. Stability ─────────────────────────────────────────
            value.stability = ValueStability.evaluate(value)

            # ── 3. Drift ─────────────────────────────────────────────
            value.drift = ValueDrift.evaluate(value, ev["shift"])

            # ── 4. Cross-subsystem convergence (replaces flat scalar) ─
            agreement = ValueConvergence.evaluate(
                value.theme, goal_state, habit_state, relationship_state, prediction_state
            )

            # ── 5. Inertia — governs how much strength can change ────
            value.inertia = ValueInertia.evaluate(value, ev["reinf"], ev["contra"])

            # Apply inertia to the effective learning rates for strength
            # If evidence contradicts, resilience provides a second buffer.
            strength_lr_modifier = 1.0 - value.inertia  # high inertia → tiny lr

            # ── 6. Resilience — buffers contradictions for stable values ─
            value.resilience = ValueResilience.evaluate(value, ev["contra"])

            # Effective contradiction = scaled down by resilience for established values
            effective_contradiction = ev["contra"] * (1.0 - value.resilience)

            # ── 7. Strength ─────────────────────────────────────────
            prev_strength = value.strength
            # Override ValueStrength's internal lr with inertia-adjusted signal
            raw_target = value.strength
            if ev["reinf"] > 0:
                raw_target = min(0.95, raw_target + ev["reinf"] * 0.05)
            if effective_contradiction > 0:
                raw_target = max(0.05, raw_target - effective_contradiction * 0.1)
            value.strength = value.strength + (raw_target - value.strength) * (0.02 * (1.0 + strength_lr_modifier))
            value.strength = max(0.05, min(0.95, value.strength))

            strength_gain = max(0.0, value.strength - prev_strength)
            strength_loss = max(0.0, prev_strength - value.strength)

            if abs(value.strength - prev_strength) > 0.05:
                value.add_history("strength_changed", value.strength - prev_strength)

            # ── 8. Recovery capacity ─────────────────────────────────
            value.recovery_capacity = ValueRecovery.evaluate(value, strength_gain, strength_loss)

            # ── 9. Confidence (stabilised, oscillation-resistant) ────
            value.confidence = ValueConfidence.evaluate(value, value.consistency, agreement)

            # ── 10. Lifecycle ────────────────────────────────────────
            new_state = ValueFormation.evaluate_lifecycle(value)
            if new_state != value.lifecycle_state:
                value.lifecycle_state = new_state

            # ── 11. Preserve ctx before clearing ────────────────────
            cached_ctx = ev["ctx"]

            # Clear evidence buffer for next tick
            value._evidence = {
                "reinf": 0.0, "contra": 0.0, "ctx": 0.0, "cons": 0.0, "shift": 0.0,
            }

            # ── 12. Categorise ───────────────────────────────────────
            ls = value.lifecycle_state
            if ls in ("EMERGING", "FORMING", "STABLE", "REINFORCED", "QUESTIONED", "SHIFTING"):
                active_values.append(value)
            elif ls == "DORMANT":
                dormant_values.append(value)
            elif ls == "EXTINCT":
                extinct_values.append(value)

            # Store cached_ctx back so salience can use it below
            value._ctx_cache = cached_ctx
            value.last_updated = time.time()

        # ── 13. Conflict level ────────────────────────────────────────
        conflict_level = ValueConflict.evaluate(active_values, tension_signal)

        # ── 14. Salience (uses preserved context + conflict) ──────────
        for value in active_values:
            ctx_relevance = getattr(value, "_ctx_cache", 0.5)
            value.salience = ValueSalience.evaluate(value, ctx_relevance, conflict_level)

        # ── 15. Hierarchy propagation ─────────────────────────────────
        self.hierarchy.propagate_salience({v.id: v for v in active_values})

        # ── 16. Sort and package ──────────────────────────────────────
        active_values.sort(key=lambda v: v.salience, reverse=True)
        dominant = active_values[0].theme if active_values else ""

        return ValueState(
            active_values=active_values,
            dormant_values=dormant_values,
            extinct_values=extinct_values,
            dominant_value_theme=dominant,
            total_value_conflict=conflict_level,
        )
