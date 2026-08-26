from .CognitiveContext import CognitiveContext
from .self_model.SelfModel import SelfModel
from .environment.Environment import Environment
from .ecology.Ecology import Ecology
from .attention.AttentionGate import AttentionGate
from .attention.AttentionTelemetry import AttentionTelemetry
from .metacognition.MetacognitiveObserver import MetacognitiveObserver
from .metacognition.ObservationTelemetry import ObservationTelemetry
from .metacognition.AwarenessHistory import AwarenessHistory
from .metacognition.AwarenessFrame import AwarenessFrame, ContextTransition
from .metacognition.AwarenessTelemetry import AwarenessTelemetry
from .metacognition.SelfReflection import SelfReflection
from .metacognition.ReflectionStabilizer import ReflectionStabilizer
from .metacognition.ReflectionTelemetry import ReflectionTelemetry
from .metacognition.CognitiveMonitor import CognitiveMonitor
from .metacognition.MonitoringTelemetry import MonitoringTelemetry
from .metacognition.IntrospectiveFeedback import IntrospectiveFeedback
from .metacognition.FeedbackTelemetry import FeedbackTelemetry
from .predictive.PredictiveConsciousness import PredictiveConsciousness
from .predictive.PredictionTelemetry import PredictionTelemetry
from .social.SocialPerception import SocialPerception
from .social.SocialTelemetry import SocialTelemetry
from .social.SocialAdaptation import SocialAdaptation
from .social.AdaptationTelemetry import AdaptationTelemetry
from .social.SocialModel import SocialModel
from .social.SocialModelTelemetry import SocialModelTelemetry
from .relationship.RelationshipCognition import RelationshipCognition
from .relationship.RelationshipTelemetry import RelationshipTelemetry
from .relationship.RelationshipStabilizationTelemetry import RelationshipStabilizationTelemetry
from .goals.GoalMemory import GoalMemory
from .goals.GoalTelemetry import GoalTelemetry
from .goals.GoalStabilizationTelemetry import GoalStabilizationTelemetry
from .habits.HabitLearning import HabitLearning
from .habits.HabitTelemetry import HabitTelemetry
from .values.PersonalValueModel import PersonalValueModel
from .values.ValueTelemetry import ValueTelemetry
from .values.ValueStabilizationTelemetry import ValueStabilizationTelemetry
from .integration.GoalHabitIntegrator import GoalHabitIntegrator
from .integration.GoalHabitTelemetry import GoalHabitTelemetry
from .curiosity.CuriosityEngine import CuriosityEngine
from .curiosity.CuriosityTelemetry import CuriosityTelemetry
from .curiosity.CuriosityStabilizationTelemetry import CuriosityStabilizationTelemetry
from .social.ExpressionBuilder import ExpressionBuilder
from .BehaviorEnvelope import BehaviorEnvelope
from .CognitiveSnapshotBuilder import CognitiveSnapshotBuilder

class AssociativeThoughtField:
    _instances = {}

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.self_model = SelfModel.get_instance(session_id)
        self.environment = Environment.get_instance(session_id)
        self.ecology = Ecology.get_instance(session_id)
        self.attention_gate = AttentionGate()
        self.awareness_history = AwarenessHistory()
        self.metacognitive_observer = MetacognitiveObserver()
        self.self_reflection = SelfReflection()
        self.reflection_stabilizer = ReflectionStabilizer()
        self.cognitive_monitor = CognitiveMonitor()
        self.introspective_feedback = IntrospectiveFeedback()
        self.predictive_consciousness = PredictiveConsciousness()
        self.social_perception = SocialPerception()
        self.social_model = SocialModel()
        self.relationship_cognition = RelationshipCognition()
        self.goal_memory = GoalMemory()
        self.habit_learning = HabitLearning()
        self.goal_habit_integrator = GoalHabitIntegrator()
        self.value_model = PersonalValueModel()
        self.curiosity_engine = CuriosityEngine()
        self.social_adaptation = SocialAdaptation()

    @classmethod
    def get_instance(cls, session_id: str):
        if session_id not in cls._instances:
            cls._instances[session_id] = cls(session_id)
        return cls._instances[session_id]

    def tick(self, context: CognitiveContext) -> str:
        # Update Self Model
        self_state = self.self_model.update(context.conversation_metadata)
        
        # Update Environment
        env_state = self.environment.tick(self_state)
        
        # Update Ecology
        if context.transcript:
            self.ecology.ingest(context.transcript, "semantic", {"attention": 1.0, "urgency": 0.5})
        self.ecology.tick(env_state.fields, self_state)
        
        # Pass through biological bottleneck
        window = self.attention_gate.filter(self.ecology.graph, env_state.fields, self_state, self.ecology.presence)
        
        # Telemetry
        AttentionTelemetry.emit(self.session_id, window)
        
        # Build Awareness Frame
        dominant_theme = window.conscious_thoughts[0] if window.conscious_thoughts else ""
        
        # Calculate Context Transition
        transition = ContextTransition.NONE
        if self.awareness_history.frames:
            last = self.awareness_history.frames[-1]
            if dominant_theme and dominant_theme != last.dominant_theme:
                transition = ContextTransition.TOPIC_SHIFT
            elif window.attention_direction != last.attention_direction:
                transition = ContextTransition.ATTENTION_SHIFT
            elif abs(self_state.reflection_depth - last.reflection_depth) > 0.1:
                transition = ContextTransition.REFLECTION_SHIFT
            elif window.emerging_insight:
                transition = ContextTransition.INSIGHT_SHIFT
        
        frame = AwarenessFrame(
            awareness_width=window.capacity,
            attention_direction=window.attention_direction,
            reflection_depth=self_state.reflection_depth,
            confidence=1.0 - self_state.comfort, # Rough proxy
            uncertainty=1.0 - self_state.comfort,
            comfort=self_state.comfort,
            emotional_momentum=sum(self.ecology.presence.pressures.values()),
            cognitive_load=self_state.cognitive_load,
            dominant_theme=dominant_theme,
            internal_tension=self.ecology.presence.pressures.get("attention", 0.0),
            awareness_density=len(window.conscious_thoughts) / max(1, window.capacity),
            context_transition=transition
        )
        self.awareness_history.append(frame)
        AwarenessTelemetry.emit(self.session_id, self.awareness_history)
        
        # Metacognitive Observation (Passive Observer)
        observation = self.metacognitive_observer.observe(window, self.awareness_history, self_state, self.ecology.presence, env_state.fields)
        ObservationTelemetry.emit(self.session_id, observation)
        
        # Self Reflection (Second Metacognitive Layer)
        raw_reflection = self.self_reflection.reflect(self.awareness_history, observation, self_state)
        
        # Reflection Stabilization (Lifecycle & Coherence)
        reflection_state = self.reflection_stabilizer.stabilize(raw_reflection, self_state, dominant_theme)
        ReflectionTelemetry.emit(self.session_id, reflection_state)
        
        # Cognitive Monitoring (Long-term Metacognitive Evolution)
        monitoring_state = self.cognitive_monitor.monitor(reflection_state, self.awareness_history)
        MonitoringTelemetry.emit(self.session_id, monitoring_state)
        
        # Introspective Feedback (Biological Homeostasis)
        feedback_state = self.introspective_feedback.regulate(monitoring_state, self_state)
        FeedbackTelemetry.emit(self.session_id, feedback_state)
        
        # Predictive Consciousness (Passive Trajectory Estimation)
        prediction_state = self.predictive_consciousness.predict(
            reflection_state, monitoring_state, self_state, self.awareness_history, window
        )
        PredictionTelemetry.emit(self.session_id, prediction_state)
        
        # Social Perception (Passive Human Estimation)
        social_state = self.social_perception.perceive(
            context.transcript, context.conversation_metadata, window, self_state, prediction_state, self.awareness_history, music_context=context.music_context
        )
        SocialTelemetry.emit(self.session_id, social_state)
        
        # Social Model (Persistent Human Understanding)
        social_model_state = self.social_model.ingest_evidence(social_state)
        SocialModelTelemetry.emit(self.session_id, social_model_state)
        
        # Relationship Cognition (Evolving Interpersonal Dynamic)
        relationship_state = self.relationship_cognition.experience(
            social_model_state, prediction_state, self_state
        )
        RelationshipTelemetry.emit(self.session_id, relationship_state)
        RelationshipStabilizationTelemetry.emit(
            self.session_id, 
            relationship_state, 
            milestones=self.relationship_cognition.history.total_milestones
        )
        
        # Goal Memory (Persistent Intentions)
        # Assuming ecology or prediction parses some goal evidence for active themes.
        # This is a passive evaluation tick for existing goals.
        goal_state = self.goal_memory.experience(relationship_state, self_state)
        GoalTelemetry.emit(self.session_id, goal_state)
        GoalStabilizationTelemetry.emit(self.session_id, goal_state)
        
        # Habit Learning (Behavioral Regularity)
        # Assuming upstream processes provide habit evidence. This evaluates elapsed time and decay.
        habit_state = self.habit_learning.experience(relationship_state, goal_state)
        HabitTelemetry.emit(self.session_id, habit_state)
        
        # Goal-Habit Integration
        alignment, goal_ev, habit_ev = self.goal_habit_integrator.integrate(goal_state, habit_state)
        GoalHabitTelemetry.emit(self.session_id, alignment)
        
        # Inject evidence for NEXT tick
        for gid, ev in goal_ev.items():
            self.goal_memory.receive_integration_evidence(gid, ev)
            
        for hid, ev in habit_ev.items():
            self.habit_learning.receive_integration_evidence(hid, ev)
        
        # Personal Value Model (Long-term motivational priorities)
        value_state = self.value_model.experience(
            relationship_state, goal_state, habit_state, prediction_state
        )
        ValueTelemetry.emit(self.session_id, value_state)
        ValueStabilizationTelemetry.emit(self.session_id, value_state)
        
        # Curiosity Engine (Intrinsic Exploration Pressure)
        curiosity_state = self.curiosity_engine.experience(
            prediction_state, monitoring_state, relationship_state,
            goal_state, habit_state, value_state
        )
        CuriosityTelemetry.emit(self.session_id, curiosity_state)
        CuriosityStabilizationTelemetry.emit(self.session_id, curiosity_state)
        
        # Social Adaptation (Expression Style Realization)
        active_mode = context.runtime_signals.get("active_mode", "adaptive")
        expression_style, drift = self.social_adaptation.adapt(
            social_model_state, social_state, self_state, prediction_state, active_mode
        )
        AdaptationTelemetry.emit(self.session_id, expression_style, drift)
        
        # Build Behavior Envelope
        cognitive_snapshot = CognitiveSnapshotBuilder.build(window, self.ecology.presence, self_state)
        behavior_expression = ExpressionBuilder.build(expression_style)
        
        return BehaviorEnvelope(
            cognitive_snapshot=cognitive_snapshot,
            behavior_expression=behavior_expression
        )
