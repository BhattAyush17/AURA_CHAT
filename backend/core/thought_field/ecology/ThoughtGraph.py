from typing import Dict, List, Tuple, Set
import uuid
from .ThoughtNode import ThoughtNode
from ..relationships.ThoughtRelationship import ThoughtRelationship
from ..incubation.IncubationSeed import IncubationSeed, IncubationState
from ..incubation.Insight import Insight

class ThoughtGraph:
    def __init__(self):
        self.nodes: Dict[str, ThoughtNode] = {}
        self.relationships: Dict[Tuple[str, str], ThoughtRelationship] = {}
        self.pending_reconsolidations: Dict[str, float] = {}
        self.incubation_seeds: Dict[str, IncubationSeed] = {}
        self.insights: Dict[str, Insight] = {}

    def add_node(self, node: ThoughtNode):
        self.nodes[node.id] = node

    def get_node(self, node_id: str) -> ThoughtNode:
        return self.nodes.get(node_id)

    def tick(self, env_fields: dict, self_state, presence):
        self.perspective_shifts_this_tick = 0
        self.merged_seeds_this_tick = 0
        self.suppressed_seeds_this_tick = 0
        self.silent_resolutions_this_tick = 0
        
        # 1. Autonomous Node Evolution
        for node in self.nodes.values():
            node.adapt(env_fields, self_state, presence)
            # Correction 1: Queue for reconsolidation instead of immediate
            if node.state == node.state.FOREGROUND:
                self.pending_reconsolidations[node.id] = max(self.pending_reconsolidations.get(node.id, 0.0), 1.0)
                
        # 2. Process Pending Reconsolidations (Accumulated Reflection)
        # presence.pressures["reflection"] represents accumulated reflection over time
        if presence.pressures.get("reflection", 0.0) > 0.5:
            # Consume some reflection pressure (it's hard work)
            presence.pressures["reflection"] = max(0.0, presence.pressures["reflection"] - 0.1)
            
            to_process = dict(self.pending_reconsolidations)
            self.pending_reconsolidations.clear()
            for node_id, ripple_strength in to_process.items():
                if ripple_strength < 0.1:
                    continue # Attenuated to zero
                    
                node = self.nodes.get(node_id)
                if node:
                    success, tension = node.assess_reconsolidation(self_state, presence, env_fields, ripple_strength)
                    if success:
                        self.perspective_shifts_this_tick += 1
                        # Correction 2: Meaning Ripple Attenuation
                        for key, rel in self.relationships.items():
                            if rel.strength > 0.5:
                                neighbor_id = key[1] if key[0] == node_id else (key[0] if key[1] == node_id else None)
                                if neighbor_id and neighbor_id in self.nodes:
                                    # Attenuate the ripple based on relationship strength
                                    new_ripple = ripple_strength * rel.strength * 0.7
                                    if new_ripple > 0.1:
                                        self.pending_reconsolidations[neighbor_id] = max(
                                            self.pending_reconsolidations.get(neighbor_id, 0.0), 
                                            new_ripple
                                        )
                    elif tension > 0.0:
                        # Correction 3: Identity rejection increases internal tension (mapped to attention)
                        presence.pressures["attention"] = min(1.0, presence.pressures.get("attention", 0.0) + tension)
                        
                        # Generate an IncubationSeed because of unresolved tension
                        seed_id = str(uuid.uuid4())
                        seed = IncubationSeed(seed_id, [node_id], "Unresolved tension from rejected reconsolidation", "Reconsolidation")
                        self.incubation_seeds[seed_id] = seed

        # 3. Autonomous Incubation Evolution
        seeds_to_remove = []
        
        # Seed Interactions (Merge, Suppress)
        seed_list = list(self.incubation_seeds.values())
        for i, s1 in enumerate(seed_list):
            for s2 in seed_list[i+1:]:
                if s1.state == IncubationState.DISSOLVED or s2.state == IncubationState.DISSOLVED:
                    continue
                    
                # Merge if origins overlap heavily or theme is identical
                overlap = len(set(s1.origin_node_ids) & set(s2.origin_node_ids))
                if (overlap > 0 or s1.origin_type == s2.origin_type) and s1.pressure < 0.4 and s2.pressure < 0.4:
                    # Merge weak seeds
                    s1.origin_node_ids = list(set(s1.origin_node_ids + s2.origin_node_ids))
                    s1.pressure += s2.pressure
                    s1.coherence = (s1.coherence + s2.coherence) / 2
                    s2.state = IncubationState.DISSOLVED
                    self.merged_seeds_this_tick += 1
                        
                # Suppress if one is dominant and other is weak
                if s1.pressure > 0.8 and s2.pressure < 0.3:
                    s2.pressure = max(0.0, s2.pressure - 0.1)
                    s2.coherence = max(0.0, s2.coherence - 0.1)
                    self.suppressed_seeds_this_tick += 1
                elif s2.pressure > 0.8 and s1.pressure < 0.3:
                    s1.pressure = max(0.0, s1.pressure - 0.1)
                    s1.coherence = max(0.0, s1.coherence - 0.1)
                    self.suppressed_seeds_this_tick += 1

        insights_candidates = []
        for seed in self.incubation_seeds.values():
            if seed.state == IncubationState.DISSOLVED:
                seeds_to_remove.append(seed.id)
                continue
            seed.adapt(env_fields, self_state, presence, self)
            if seed.state == IncubationState.DISSOLVED:
                seeds_to_remove.append(seed.id)
            elif seed.state == IncubationState.INSIGHT:
                insights_candidates.append(seed)
                
        # Competing Insights
        if insights_candidates:
            # Only the most coherent/mature collapses. Others stay MATURING.
            insights_candidates.sort(key=lambda s: s.coherence + s.maturity, reverse=True)
            winner = insights_candidates[0]
            
            insight_id = str(uuid.uuid4())
            insight = Insight(insight_id, [winner.id], winner.origin_node_ids, winner.theme)
            insight.identity_impact = winner.maturity * 0.2
            insight.emotional_impact = presence.pressures.get("reflection", 0.0) * 0.3
            insight.relationship_impact = winner.coherence * 0.2
            insight.integration_level = (winner.coherence + winner.maturity) / 2.0
            self.insights[insight_id] = insight
            seeds_to_remove.append(winner.id)
            
            # Losers regress slightly to Maturing
            for loser in insights_candidates[1:]:
                loser.state = IncubationState.MATURING
                loser.coherence *= 0.9
                
        for seed_id in seeds_to_remove:
            if seed_id in self.incubation_seeds:
                del self.incubation_seeds[seed_id]
            
        # 4. Insight Feedback Loop (Ecological Feedback before conversation)
        # Insight -> Self Model -> Presence -> Relationship -> Thought Ecology
        for insight in self.insights.values():
            if not insight.applied:
                # Modify Self Model
                self_state.comfort = max(0.0, min(1.0, self_state.comfort + insight.identity_impact))
                
                # Modify Presence
                presence.pressures["reflection"] = max(0.0, presence.pressures.get("reflection", 0.0) - insight.identity_impact)
                presence.pressures["attention"] = max(0.0, presence.pressures.get("attention", 0.0) - insight.emotional_impact)
                
                # Quiet Resolution - check if integration level is too low for speech
                if insight.integration_level < 0.6:
                    self.silent_resolutions_this_tick += 1
                
                # We do NOT generate text or BehaviorEnvelope directly.
                insight.applied = True

        # 5. Emergent Relationship Topology
        active_nodes = [n for n in self.nodes.values() if n.energy > 0.4]
        
        # When two thoughts co-activate, their relationship naturally adapts
        for i, n1 in enumerate(active_nodes):
            for n2 in active_nodes[i+1:]:
                # Sort IDs to ensure consistent undirected edges in dictionary
                key = tuple(sorted((n1.id, n2.id)))
                if key not in self.relationships:
                    self.relationships[key] = ThoughtRelationship(n1.id, n2.id)
                self.relationships[key].adapt(n1.energy, n2.energy)
                
        # 3. Autonomous Relationship Evolution & Local Influence Propagation
        # Relationships decay naturally over time if not co-activated
        # High strength relationships slowly pull nodes closer together (migrate energy)
        keys_to_remove = []
        for key, rel in self.relationships.items():
            n1 = self.nodes.get(rel.source_id)
            n2 = self.nodes.get(rel.target_id)
            if not n1 or not n2:
                keys_to_remove.append(key)
                continue
                
            # Relationships evolve continuously even if not both active
            if n1.energy <= 0.4 or n2.energy <= 0.4:
                rel.adapt(n1.energy, n2.energy)
                
            # Influence Propagation (Cluster emergence)
            if rel.strength > 0.6:
                # Energy bleeds between highly connected thoughts
                if n1.energy > 0.8 and n2.energy < 0.8:
                    n2.energy = min(1.0, n2.energy + (n1.energy * rel.strength * 0.05))
                elif n2.energy > 0.8 and n1.energy < 0.8:
                    n1.energy = min(1.0, n1.energy + (n2.energy * rel.strength * 0.05))
                    
            # Cleanup completely dead relationships
            if rel.strength <= 0.01 and rel.history <= 0.01:
                keys_to_remove.append(key)
                
        for key in keys_to_remove:
            del self.relationships[key]

    def get_dominant_nodes(self) -> List[ThoughtNode]:
        from .ThoughtState import ThoughtState
        return [n for n in self.nodes.values() if n.state == ThoughtState.FOREGROUND]

    def get_echo_nodes(self) -> List[ThoughtNode]:
        return []
