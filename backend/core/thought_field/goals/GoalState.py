from dataclasses import dataclass, field
from typing import Dict, List
from .Goal import Goal

@dataclass(frozen=True)
class GoalState:
    """
    Immutable representation of all current goals.
    """
    active_goals: List[Goal]
    dormant_goals: List[Goal]
    fulfilled_goals: List[Goal]
    abandoned_goals: List[Goal]
    
    # High-level tracking
    total_active_momentum: float = 0.0
    dominant_goal_theme: str = ""
    goal_conflict_level: float = 0.0
