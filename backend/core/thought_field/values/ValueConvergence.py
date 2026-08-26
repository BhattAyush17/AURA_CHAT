from ..goals.GoalState import GoalState
from ..habits.HabitState import HabitState
from ..relationship.RelationshipState import RelationshipState
from ..predictive.PredictionState import PredictionState

class ValueConvergence:
    """
    Evaluates cross-subsystem agreement for a given value theme.
    
    A value gains genuine confidence only when multiple independent evidence
    streams converge on the same motivational signal. No single subsystem
    can dominate confidence — agreement strengthens, disagreement weakens.
    
    Returns a convergence score between 0.0 and 1.0.
    """
    @staticmethod
    def evaluate(
        value_theme: str,
        goal_state: GoalState,
        habit_state: HabitState,
        relationship_state: RelationshipState,
        prediction_state: PredictionState,
    ) -> float:
        signals: list[float] = []

        # ── Goal signal ──────────────────────────────────────────────
        # Does any active goal share thematic proximity?
        for goal in goal_state.active_goals:
            if value_theme.lower() in goal.theme.lower() or goal.theme.lower() in value_theme.lower():
                signals.append(goal.confidence * goal.momentum)
                break
        else:
            signals.append(0.0)

        # ── Habit signal ─────────────────────────────────────────────
        # Does any active habit share thematic proximity?
        for habit in habit_state.active_habits:
            if value_theme.lower() in habit.theme.lower() or habit.theme.lower() in value_theme.lower():
                signals.append(habit.confidence * habit.strength)
                break
        else:
            signals.append(0.0)

        # ── Relationship signal ───────────────────────────────────────
        # A deep, trusting relationship reinforces connection-related values;
        # but we treat it as a flat signal for all values — trust correlates
        # with willingness to engage meaningfully with any value.
        signals.append(relationship_state.trust_level * 0.5)

        # ── Prediction signal ────────────────────────────────────────
        # If the prediction layer anticipates continued engagement, it weakly
        # supports value persistence (no direct thematic matching here).
        signals.append(prediction_state.predicted_curiosity * 0.3)

        if not signals:
            return 0.0

        # Agreement = mean of normalised signals (cap each signal at 1.0)
        return min(1.0, sum(min(1.0, s) for s in signals) / len(signals))
