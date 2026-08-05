from .AwarenessWindow import AwarenessWindow
from .AttentionFocus import AttentionFocus

class AttentionGate:
    def __init__(self):
        self.focus = AttentionFocus()
        self.window = AwarenessWindow()
        
    def filter(self, graph, env_fields, self_state, presence):
        """
        The biological bottleneck.
        Evaluates thousands of active structures but only allows a few to pass into the Awareness Window.
        """
        # 1. Adapt Window and Drift Focus
        stress = env_fields.get("urgency").intensity if env_fields.get("urgency") else 0.0
        self.window.adapt_capacity(self_state.mental_energy, self_state.cognitive_load, stress)
        self.focus.drift(env_fields, presence)
        self.window.attention_direction = self.focus.primary_target
        
        # 2. Gather candidates from the subconscious ecology
        active_nodes = [n for n in graph.nodes.values() if n.energy > 0.3]
        insights = [i for i in graph.insights.values()]
        
        scored_candidates = []
        
        # Score thoughts based on biological relevance, not just math ranking
        for node in active_nodes:
            # Relevancy factors
            urgency_pull = stress if node.type == "semantic" else 0.0
            identity_pull = self_state.reflection_depth if node.type == "episodic" else 0.0
            tension_pull = presence.pressures.get("attention", 0.0) if node.energy > 0.8 else 0.0
            
            total_pull = (node.energy * 0.4) + (urgency_pull * 0.3) + (tension_pull * 0.2) + (identity_pull * 0.1)
            
            # Suppression of weak or redundant thoughts
            if total_pull < 0.2:
                self.window.suppressed_count += 1
                continue
                
            scored_candidates.append((total_pull, f"[{node.type.upper()}] {node.interpretations[-1].content[:50]}..."))
            
        # 3. Sort and truncate to window capacity
        scored_candidates.sort(key=lambda x: x[0], reverse=True)
        conscious_candidates = [c[1] for c in scored_candidates[:self.window.capacity]]
        self.window.suppressed_count += max(0, len(scored_candidates) - self.window.capacity)
        
        self.window.conscious_thoughts = conscious_candidates
        
        # 4. Expose highest-integration insight (if any)
        self.window.emerging_insight = ""
        if insights:
            # Sort by integration level
            integrated = sorted(insights, key=lambda x: x.integration_level, reverse=True)
            if integrated[0].integration_level >= 0.6:
                self.window.emerging_insight = f"Insight ({integrated[0].theme}) - Confidence: {integrated[0].confidence:.1f}"
                
        # 5. Build Awareness Summary (Internal conscious narrative)
        if not conscious_candidates and not self.window.emerging_insight:
            self.window.awareness_summary = "Mind is quiet."
        else:
            self.window.awareness_summary = f"Focusing on {len(conscious_candidates)} active thoughts."
            
        return self.window
