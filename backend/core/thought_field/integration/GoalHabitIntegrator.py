from typing import Dict, Tuple
from ..goals.GoalState import GoalState
from ..habits.HabitState import HabitState
from .GoalHabitAlignment import GoalHabitAlignment, AlignmentData
from .GoalHabitEvidence import GoalHabitEvidence

class GoalHabitIntegrator:
    """
    Biological Integration Layer between Intention (Goals) and Behavior (Habits).
    Does NOT modify objects directly.
    Generates bounded structural evidence for the next cycle.
    """
    def __init__(self):
        self.alignment_history = []
        self.misalignment_history = []
        
    def _semantic_match(self, goal_theme: str, habit_theme: str) -> float:
        # Simplistic semantic matching for alignment detection.
        # Uses word overlap to detect if behavior is aligned with intention.
        g_words = set(goal_theme.lower().split())
        h_words = set(habit_theme.lower().split())
        if not g_words or not h_words:
            return 0.0
        overlap = len(g_words.intersection(h_words))
        if overlap > 0:
            return float(overlap) / min(len(g_words), len(h_words))
        return 0.0
        
    def integrate(self, goal_state: GoalState, habit_state: HabitState) -> Tuple[GoalHabitAlignment, Dict[str, GoalHabitEvidence], Dict[str, GoalHabitEvidence]]:
        """
        Calculates alignment and produces evidence for next tick.
        No recursive loop - evidence produced here applies to next tick's stabilize cycle.
        """
        alignment = GoalHabitAlignment()
        
        goal_evidence: Dict[str, GoalHabitEvidence] = {g.id: GoalHabitEvidence() for g in goal_state.active_goals}
        habit_evidence: Dict[str, GoalHabitEvidence] = {h.id: GoalHabitEvidence() for h in habit_state.active_habits}
        
        # Cross-compare Active Goals and Active Habits
        for goal in goal_state.active_goals:
            goal_supported = False
            for habit in habit_state.active_habits:
                match_score = self._semantic_match(goal.theme, habit.theme)
                
                # Rule 5: Alignment Detection
                if match_score > 0.3:
                    align_score = goal.confidence * habit.strength * match_score
                    alignment.alignments.append(AlignmentData(goal.id, habit.id, align_score))
                    alignment.total_alignment += align_score
                    alignment.supporting_habits += 1
                    goal_supported = True
                    
                    # Rule 3: Habit -> Goal Evidence (Established habits reinforce goal confidence)
                    goal_evidence[goal.id].habit_reinforcement += habit.strength * match_score * 0.1
                    
                    # Rule 2: Goal -> Habit Evidence (Active goals increase probability that aligned habits strengthen)
                    habit_evidence[habit.id].goal_support_weight += goal.confidence * match_score * 0.1
                    
            # Rule 4: Misalignment Detection
            # Rule 6: Long-Term Drift
            # If Strong Goal (confidence > 0.6) has no supporting habit -> Misalignment
            if not goal_supported and goal.confidence > 0.6:
                misalign_score = goal.confidence * 0.5
                alignment.total_misalignment += misalign_score
                alignment.unsupported_goals += 1
                
                # Rule 6: Long-Term Drift (Habits repeatedly contradict/fail to support goals)
                goal_evidence[goal.id].habit_contradiction += 0.1
                
        # Track trends
        self.alignment_history.append(alignment.total_alignment)
        self.misalignment_history.append(alignment.total_misalignment)
        
        if len(self.alignment_history) > 10:
            self.alignment_history.pop(0)
            self.misalignment_history.pop(0)
            
        if len(self.alignment_history) >= 2:
            alignment.alignment_trend = self.alignment_history[-1] - self.alignment_history[0]
            alignment.misalignment_trend = self.misalignment_history[-1] - self.misalignment_history[0]
            
        return alignment, goal_evidence, habit_evidence
