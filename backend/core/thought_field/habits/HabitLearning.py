from typing import Dict, List
import time
from .Habit import Habit
from .HabitState import HabitState
from .HabitFormation import HabitFormation
from .HabitStrength import HabitStrength
from .HabitConfidence import HabitConfidence
from .HabitSalience import HabitSalience
from .HabitDecay import HabitDecay
from .HabitRecovery import HabitRecovery
from .HabitContext import HabitContext
from ..relationship.RelationshipState import RelationshipState
from ..goals.GoalState import GoalState
from ..integration.GoalHabitEvidence import GoalHabitEvidence

class HabitLearning:
    """
    Canonical owner of behavioral regularity.
    Continuously discovers recurring patterns over weeks and months.
    
    ARCHITECTURAL INVARIANT: HABIT IS EVIDENCE, NOT IDENTITY
    - Habit Learning tracks WHAT repeatedly happens (behavioral regularity).
    - It MUST NEVER attach psychological meaning to these observations.
    - It MUST NEVER read IdentityState (to prevent confirmation bias).
    - Only downstream Identity Evolution can synthesize habits into identity.
    """
    def __init__(self):
        self.habits: Dict[str, Habit] = {}
        
    def add_or_update_habit_evidence(self,
                                     habit_id: str,
                                     theme: str,
                                     frequency_signal: float = 0.0,
                                     consistency_signal: float = 0.0,
                                     current_context: Dict[str, str] = None):
        """
        Receives extracted behavioral patterns from upstream systems.
        Never receives raw text.
        """
        if current_context is None:
            current_context = {}
            
        if habit_id not in self.habits:
            self.habits[habit_id] = Habit(id=habit_id, theme=theme)
            
        habit = self.habits[habit_id]
        
        if not hasattr(habit, '_evidence'):
            habit._evidence = {'freq': 0.0, 'cons': 0.0, 'ctx': {}}
            
        habit._evidence['freq'] += frequency_signal
        habit._evidence['cons'] += consistency_signal
        habit._evidence['ctx'].update(current_context)
        
        if frequency_signal > 0:
            habit.last_observed = time.time()
            
    def receive_integration_evidence(self, habit_id: str, evidence: GoalHabitEvidence):
        """
        Receives bounded structural evidence from Goal-Habit Integration.
        This will be applied in the NEXT experience tick to prevent recursive loops.
        """
        if habit_id in self.habits:
            if not hasattr(self.habits[habit_id], '_evidence'):
                self.habits[habit_id]._evidence = {'freq': 0.0, 'cons': 0.0, 'ctx': {}}
                
            # Rule 2: Goal -> Habit Evidence (Active goals increase probability that aligned habits strengthen)
            self.habits[habit_id]._evidence['freq'] += evidence.goal_support_weight
            self.habits[habit_id]._evidence['cons'] += evidence.goal_support_weight
            
    def experience(self, relationship_state: RelationshipState, goal_state: GoalState) -> HabitState:
        """
        Evolves all habits based on elapsed time and accumulated evidence.
        """
        active_habits = []
        dormant_habits = []
        extinct_habits = []
        
        total_salience = 0.0
        
        for habit_id, habit in self.habits.items():
            ev = getattr(habit, '_evidence', {'freq': 0.0, 'cons': 0.0, 'ctx': {}})
            
            # 1. Update Context Affinity
            if ev['ctx']:
                HabitContext.update_affinity(habit, ev['ctx'])
                
            # 2. Evaluate Context Match
            context_match = HabitContext.evaluate_match(habit, ev['ctx'])
            
            # 3. Update Salience
            habit.salience = HabitSalience.evaluate(habit, context_match)
            
            # 4. Update Strength & Decay
            if ev['freq'] > 0:
                habit.strength = HabitStrength.evaluate(habit, ev['freq'], ev['cons'])
            else:
                habit.strength = HabitDecay.evaluate(habit)
                
            # 5. Update Confidence
            habit.confidence = HabitConfidence.evaluate(habit, ev['cons'])
            
            # 6. Update Recovery Capacity
            habit.recovery_capacity = HabitRecovery.evaluate(habit, ev['freq'])
            
            # 7. Update Stability (Simple average of strength and confidence)
            habit.stability = (habit.strength + habit.confidence) / 2.0
            
            # 8. Update Lifecycle
            new_state = HabitFormation.evaluate_lifecycle(habit)
            if new_state != habit.lifecycle_state:
                habit.lifecycle_state = new_state
                
            # Clear evidence for next tick
            habit._evidence = {'freq': 0.0, 'cons': 0.0, 'ctx': {}}
            
            # Categorize
            state_str = habit.lifecycle_state
            if state_str in ["DISCOVERING", "FORMING", "ESTABLISHED", "STABLE", "WEAKENING", "REVIVING"]:
                active_habits.append(habit)
                total_salience += habit.salience
            elif state_str == "DORMANT":
                dormant_habits.append(habit)
            elif state_str == "EXTINCT":
                extinct_habits.append(habit)
                
            habit.last_updated = time.time()
                
        # Sort active habits by salience
        active_habits.sort(key=lambda h: h.salience, reverse=True)
        dominant = active_habits[0].theme if active_habits else ""
        
        return HabitState(
            active_habits=active_habits,
            dormant_habits=dormant_habits,
            extinct_habits=extinct_habits,
            dominant_habit_theme=dominant,
            total_habit_salience=total_salience
        )
