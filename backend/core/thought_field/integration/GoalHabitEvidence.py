from dataclasses import dataclass

@dataclass
class GoalHabitEvidence:
    """
    Bounded evidence exchange between Goals and Habits.
    No direct object mutation.
    """
    # For GoalMemory (from Habits)
    habit_reinforcement: float = 0.0
    habit_contradiction: float = 0.0
    
    # For HabitLearning (from Goals)
    goal_support_weight: float = 0.0
