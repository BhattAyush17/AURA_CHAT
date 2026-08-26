from dataclasses import dataclass, field
from typing import Dict, List
from .Habit import Habit

@dataclass(frozen=True)
class HabitState:
    """
    Immutable representation of all current habits.
    """
    active_habits: List[Habit]
    dormant_habits: List[Habit]
    extinct_habits: List[Habit]
    
    # High-level tracking
    dominant_habit_theme: str = ""
    total_habit_salience: float = 0.0
