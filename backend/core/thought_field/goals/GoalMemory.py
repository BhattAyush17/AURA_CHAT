from typing import Dict, List, Optional
from .Goal import Goal
from .GoalState import GoalState
from .GoalStabilizer import GoalStabilizer
from .GoalConflict import GoalConflict
from ..relationship.RelationshipState import RelationshipState
from ..self_model.SelfState import SelfState
from ..integration.GoalHabitEvidence import GoalHabitEvidence

class GoalMemory:
    """
    Canonical owner of persistent objectives inside the cognitive architecture.
    Does NOT determine what a goal is (upstream processors do that).
    Determines HOW the goal evolves based on biological parameters.
    """
    def __init__(self):
        self.goals: Dict[str, Goal] = {}
        
    def add_or_update_goal_evidence(self, 
                                    goal_id: str, 
                                    theme: str,
                                    reinforcement_strength: float = 0.0,
                                    contradiction_strength: float = 0.0,
                                    activity_strength: float = 0.0,
                                    progress_delta: float = 0.0,
                                    identity_alignment: float = 0.5):
        """
        Receives extracted goal evidence from upstream systems (like Ecology or Prediction).
        Never receives raw text.
        """
        if goal_id not in self.goals:
            self.goals[goal_id] = Goal(id=goal_id, theme=theme, identity_alignment=identity_alignment)
            
        if not hasattr(self.goals[goal_id], '_evidence'):
            self.goals[goal_id]._evidence = {
                'reinf': 0.0, 'contra': 0.0, 'act': 0.0, 'prog': 0.0
            }
            
        self.goals[goal_id]._evidence['reinf'] += reinforcement_strength
        self.goals[goal_id]._evidence['contra'] += contradiction_strength
        self.goals[goal_id]._evidence['act'] += activity_strength
        self.goals[goal_id]._evidence['prog'] += progress_delta
        
    def receive_integration_evidence(self, goal_id: str, evidence: GoalHabitEvidence):
        """
        Receives bounded structural evidence from Goal-Habit Integration.
        This will be applied in the NEXT experience tick to prevent recursive loops.
        """
        if goal_id in self.goals:
            if not hasattr(self.goals[goal_id], '_evidence'):
                self.goals[goal_id]._evidence = {
                    'reinf': 0.0, 'contra': 0.0, 'act': 0.0, 'prog': 0.0
                }
            self.goals[goal_id]._evidence['reinf'] += evidence.habit_reinforcement
            self.goals[goal_id]._evidence['contra'] += evidence.habit_contradiction
        
    def experience(self, relationship_state: RelationshipState, self_state: SelfState) -> GoalState:
        """
        Evolves all goals based on elapsed time and accumulated evidence.
        """
        active_goals = []
        dormant_goals = []
        fulfilled_goals = []
        abandoned_goals = []
        
        total_momentum = 0.0
        
        for goal_id, goal in self.goals.items():
            ev = getattr(goal, '_evidence', {'reinf': 0.0, 'contra': 0.0, 'act': 0.0, 'prog': 0.0})
            
            # Stabilize
            GoalStabilizer.stabilize_goal(
                goal, 
                ev['reinf'], ev['contra'], ev['act'], ev['prog'],
                relationship_state, self_state
            )
            
            # Clear evidence for next tick
            goal._evidence = {'reinf': 0.0, 'contra': 0.0, 'act': 0.0, 'prog': 0.0}
            
            # Categorize
            state_str = goal.lifecycle_state
            if state_str in ["ACTIVE", "STABLE", "FORMING", "PROPOSED", "REVIVED"]:
                active_goals.append(goal)
                total_momentum += goal.momentum
            elif state_str == "DORMANT":
                dormant_goals.append(goal)
            elif state_str == "FULFILLED":
                fulfilled_goals.append(goal)
            elif state_str == "ABANDONED":
                abandoned_goals.append(goal)
                
        # Sort active goals by importance * confidence
        active_goals.sort(key=lambda g: g.importance * g.confidence, reverse=True)
        dominant = active_goals[0].theme if active_goals else ""
        
        # Evaluate Conflict
        conflict_level = GoalConflict.evaluate(active_goals)
        
        return GoalState(
            active_goals=active_goals,
            dormant_goals=dormant_goals,
            fulfilled_goals=fulfilled_goals,
            abandoned_goals=abandoned_goals,
            total_active_momentum=total_momentum,
            dominant_goal_theme=dominant,
            goal_conflict_level=conflict_level
        )
