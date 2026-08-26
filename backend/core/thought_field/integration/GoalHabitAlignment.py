from dataclasses import dataclass, field
from typing import List

@dataclass
class AlignmentData:
    goal_id: str
    habit_id: str
    alignment_score: float # >0 means aligned, <0 means misaligned

@dataclass
class GoalHabitAlignment:
    alignments: List[AlignmentData] = field(default_factory=list)
    total_alignment: float = 0.0
    total_misalignment: float = 0.0
    alignment_trend: float = 0.0
    misalignment_trend: float = 0.0
    supporting_habits: int = 0
    unsupported_goals: int = 0
