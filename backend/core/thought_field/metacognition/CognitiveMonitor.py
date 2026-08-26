from .MonitoringState import MonitoringState
from .MonitoringHistory import MonitoringHistory
from .AwarenessHistory import AwarenessHistory

class CognitiveMonitor:
    def __init__(self):
        self.history = MonitoringHistory()
        self.fatigue = 0.0
        
    def monitor(self, reflection_state, awareness_history: AwarenessHistory) -> MonitoringState:
        """
        Observes the long-term evolution of Reflection.
        Completely passive. Does not modify behavior or SelfState.
        Executes in <1ms.
        """
        self.history.append(reflection_state)
        
        # 1. Base Metrics
        lt_confidence = self.history.average_confidence()
        persistence = self.history.reflection_persistence()
        resolution = self.history.reflection_resolution_rate()
        id_stability = self.history.identity_stability()
        drift = self.history.attention_drift()
        oscillation = self.history.oscillation_index()
        
        # 2. Cognitive Fatigue Estimation
        # Fatigue grows with high drift, high oscillation, and high reflection pressure.
        # It decays slowly during high stability and resolution.
        fatigue_growth = 0.0
        if drift > 0.5: fatigue_growth += 0.02
        if oscillation > 0.3: fatigue_growth += 0.03
        if reflection_state.identity_pressure > 0.7: fatigue_growth += 0.01
        
        fatigue_decay = 0.0
        if id_stability > 0.8: fatigue_decay += 0.02
        if resolution > 0.2: fatigue_decay += 0.02
        
        self.fatigue = max(0.0, min(1.0, self.fatigue + fatigue_growth - fatigue_decay))
        
        # 3. Curiosity Trend (Derived from AwarenessHistory)
        curiosity_trend = 0.0
        if awareness_history.is_sufficient():
            # If focus persists without massive tension, curiosity is healthy
            curiosity_trend = awareness_history.focus_persistence() * (1.0 - awareness_history.tension_growth())
            
        # 4. Monitor Confidence
        # How reliable is this monitoring state?
        # Requires enough history and not massive oscillation.
        monitor_confidence = 0.0
        if self.history.is_sufficient():
            monitor_confidence = 1.0 - (oscillation * 0.5)
            
        return MonitoringState(
            long_term_confidence=lt_confidence,
            reflection_persistence=persistence,
            reflection_resolution_rate=resolution,
            identity_stability=id_stability,
            attention_drift=drift,
            curiosity_trend=curiosity_trend,
            cognitive_fatigue=self.fatigue,
            oscillation_index=oscillation,
            monitor_confidence=monitor_confidence
        )
