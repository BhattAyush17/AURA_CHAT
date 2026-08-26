import time
from typing import Set, List, Tuple
from .ThoughtState import ThoughtState
from .ThoughtAffinity import ThoughtAffinity
from ..reconsolidation.ThoughtInterpretation import ThoughtInterpretation

class ThoughtNode:
    def __init__(self, node_id: str, experience: str, node_type: str, affinity: ThoughtAffinity = None):
        self.id = node_id
        self.experience = experience # Immutable historical fact
        self.type = node_type
        self.affinity = affinity or ThoughtAffinity()
        
        # Interpretations evolve over time
        initial_interp = ThoughtInterpretation(
            content=experience,
            confidence=0.8,
            emotional_meaning=self.affinity.comfort,
            identity_meaning=self.affinity.identity,
            relationship_meaning=self.affinity.relationship
        )
        self.interpretations: List[ThoughtInterpretation] = [initial_interp]
        
        # Living properties
        self.state = ThoughtState.INVISIBLE
        self.energy = 0.5
        self.stability = 0.5
        # Correction 3: Plasticity (Resistance to change)
        # Deep identity memories have low plasticity.
        self.plasticity = 1.0 - (self.affinity.identity * 0.5) - (self.affinity.comfort * 0.2)
        
        self.last_updated = time.time()

    def adapt(self, env_fields: dict, self_state, presence):
        now = time.time()
        elapsed = now - self.last_updated
        if elapsed < 0.1:
            return # Evolve independently, don't force synchronized rapid ticks
            
        # 1. Resonate with environment and presence (context priming)
        resonance = self.affinity.get_environmental_resonance(env_fields) + (presence.get_resonance(self.affinity) * 0.5)
        
        # 2. State-specific autonomous behaviors
        if self.state in (ThoughtState.INVISIBLE, ThoughtState.DORMANT):
            self.incubate(resonance, elapsed)
        elif self.state == ThoughtState.FOREGROUND:
            self.stabilize(resonance, elapsed)
            
        self.decay(elapsed, presence)
        
        # 3. State transitions based on energy
        if self.energy > 0.8:
            self.state = ThoughtState.FOREGROUND
        elif self.energy > 0.4:
            self.state = ThoughtState.EMERGING
        elif self.energy > 0.1:
            self.state = ThoughtState.DORMANT
        else:
            self.state = ThoughtState.INVISIBLE
            
        self.last_updated = now

    def incubate(self, resonance: float, elapsed: float):
        # Subconscious growth if resonance is high
        if resonance > 0.5:
            self.energy += (resonance * 0.05) * (elapsed / 60.0)

    def stabilize(self, resonance: float, elapsed: float):
        # Foreground thoughts stabilize and resist decay
        self.stability = min(1.0, self.stability + (elapsed / 3600.0))

    def decay(self, elapsed: float, presence):
        # Continuous decay based on stability and time
        decay_amount = (1.0 - self.stability) * (elapsed / 3600.0)
        old_energy = self.energy
        self.energy = max(0.0, min(1.0, self.energy - decay_amount))
        
        # If dropping out of awareness, deposit residue
        if old_energy > 0.4 and self.energy <= 0.4:
            presence.deposit(self.affinity, 0.2)

    def assess_reconsolidation(self, self_state, presence, env_fields, ripple_strength=1.0) -> Tuple[bool, float]:
        # Correction 1: Reconsolidation doesn't happen immediately upon foreground
        # Instead, it queues for reflection.
        
        # Correction 5: Reconsolidation Eligibility
        latest = self.interpretations[-1]
        
        env_emotion = env_fields.get("emotional")
        current_emotion_intensity = env_emotion.intensity if env_emotion else 0.5
        
        # Correction 7: Meaning emerges from ecology
        # Calculate drift using Self, Environment, Presence, and Relationships
        # We'll approximate relationships by looking at presence context
        emotion_drift = abs(latest.emotional_meaning - current_emotion_intensity)
        identity_drift = abs(latest.identity_meaning - self_state.comfort)
        presence_drift = abs(latest.relationship_meaning - presence.pressures.get("relationship", 0.0))
        
        # Ripple strength scales the perceived drift (further ripples cause less change)
        total_drift = (emotion_drift + identity_drift + presence_drift) * self.plasticity * ripple_strength
        
        # Traumatic/deep memories (low plasticity, high identity meaning) reconsolidate slower
        threshold = 0.2 + (self.stability * 0.3)
        
        if total_drift < 0.05:
            # Correction 6: Memory Reinforcement
            # If it's recalled but nothing changes, it just becomes more stable and confident.
            self.stability = min(1.0, self.stability + 0.02)
            latest.confidence = min(1.0, latest.confidence + 0.02)
            return False, 0.0
            
        # Correction 3: Reconsolidation should occasionally fail
        # High identity meaning can reject the change even if drift is high
        if total_drift > threshold and latest.identity_meaning > 0.8:
            # Deeply anchored belief rejects the change. Generates tension.
            tension_generated = total_drift * 0.5
            return False, tension_generated
            
        if total_drift > threshold:
            # Major realization
            drift_factor = 0.1
        else:
            # Correction 9: Tiny memory drift
            drift_factor = 0.02
            
        new_confidence = max(0.1, min(1.0, latest.confidence - (total_drift * drift_factor) + 0.05))
        
        emotion_dir = 1 if current_emotion_intensity > latest.emotional_meaning else -1
        id_dir = 1 if self_state.comfort > latest.identity_meaning else -1
        rel_dir = 1 if presence.pressures.get("relationship", 0.0) > latest.relationship_meaning else -1
        
        new_interp = ThoughtInterpretation(
            content=latest.content, 
            confidence=new_confidence,
            emotional_meaning=latest.emotional_meaning + (emotion_drift * drift_factor * emotion_dir),
            identity_meaning=latest.identity_meaning + (identity_drift * drift_factor * id_dir),
            relationship_meaning=latest.relationship_meaning + (presence_drift * drift_factor * rel_dir)
        )
        self.interpretations.append(new_interp)
        
        # Correction 2: Interpretations should compress/merge
        if len(self.interpretations) > 5:
            # Merge oldest two
            oldest = self.interpretations.pop(0)
            next_oldest = self.interpretations[0]
            # Simple average for demonstration
            next_oldest.emotional_meaning = (oldest.emotional_meaning + next_oldest.emotional_meaning) / 2
            next_oldest.identity_meaning = (oldest.identity_meaning + next_oldest.identity_meaning) / 2
            next_oldest.relationship_meaning = (oldest.relationship_meaning + next_oldest.relationship_meaning) / 2
        
        # Reconsolidation affects affinity and stability
        self.affinity.identity = new_interp.identity_meaning
        self.stability = min(1.0, self.stability + (0.1 if total_drift > threshold else 0.01))
        
        # Correction 8: Identity evolves (feedback to self_state)
        # Small feedback loop to SelfState comfort
        if total_drift > threshold:
            self_state.comfort = min(1.0, max(0.0, self_state.comfort + (id_dir * 0.02)))
        
        # Presence is altered (old meaning drops, new emerges)
        presence.deposit(self.affinity, total_drift * 0.1)
        
        # Correction 4: Meaning Ripple (trigger neighbors to reconsider)
        # This will be handled by the graph iterating over relationships
        return True, 0.0
