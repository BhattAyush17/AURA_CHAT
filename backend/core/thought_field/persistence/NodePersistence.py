import json
import os
from ..ecology.ThoughtGraph import ThoughtGraph
from ..ecology.ThoughtNode import ThoughtNode
from ..ecology.ThoughtAffinity import ThoughtAffinity
from ..relationships.ThoughtRelationship import ThoughtRelationship
from ..presence.CognitivePresence import CognitivePresence
from ..reconsolidation.ThoughtInterpretation import ThoughtInterpretation
from ..incubation.IncubationSeed import IncubationSeed
from ..incubation.Insight import Insight

class NodePersistence:
    STORAGE_DIR = "/tmp/aura_thought_ecology"

    def __init__(self):
        os.makedirs(self.STORAGE_DIR, exist_ok=True)

    def load(self, session_id: str):
        graph = ThoughtGraph()
        presence = CognitivePresence()
        filepath = os.path.join(self.STORAGE_DIR, f"{session_id}.json")
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                    
                if "presence" in data:
                    presence.load_dict(data["presence"])
                
                for node_data in data.get("nodes", []):
                    affinity = ThoughtAffinity(**node_data.get("affinity", {}))
                    node = ThoughtNode(node_data["id"], node_data["experience"], node_data["type"], affinity)
                    
                    interps = []
                    for interp_data in node_data.get("interpretations", []):
                        interps.append(ThoughtInterpretation.from_dict(interp_data))
                    if interps:
                        node.interpretations = interps
                        
                    node.energy = node_data.get("energy", 0.0)
                    graph.add_node(node)
                    
                for rel_data in data.get("relationships", []):
                    rel = ThoughtRelationship.from_dict(rel_data)
                    key = tuple(sorted((rel.source_id, rel.target_id)))
                    graph.relationships[key] = rel
                    
                for seed_data in data.get("incubation_seeds", []):
                    seed = IncubationSeed.from_dict(seed_data)
                    graph.incubation_seeds[seed.id] = seed
                    
                for insight_data in data.get("insights", []):
                    insight = Insight.from_dict(insight_data)
                    graph.insights[insight.id] = insight
                
                return graph, presence
            except Exception:
                pass
        
        # Initial empty graph and presence if nothing loaded
        return graph, presence

    def save(self, session_id: str, graph: ThoughtGraph, presence: CognitivePresence):
        filepath = os.path.join(self.STORAGE_DIR, f"{session_id}.json")
        nodes_data = []
        for node in graph.nodes.values():
            if node.energy > 0.05: # Only save active thoughts to prevent unbounded growth
                nodes_data.append({
                    "id": node.id,
                    "experience": node.experience,
                    "type": node.type,
                    "energy": round(node.energy, 3),
                    "affinity": node.affinity.__dict__,
                    "interpretations": [i.to_dict() for i in node.interpretations]
                })
                
        rels_data = []
        for rel in graph.relationships.values():
            if rel.history > 0.05 or rel.strength > 0.05:
                rels_data.append(rel.to_dict())
                
        seeds_data = [s.to_dict() for s in graph.incubation_seeds.values()]
        insights_data = [i.to_dict() for i in graph.insights.values()]
        
        with open(filepath, 'w') as f:
            json.dump({
                "nodes": nodes_data, 
                "relationships": rels_data,
                "presence": presence.to_dict(),
                "incubation_seeds": seeds_data,
                "insights": insights_data
            }, f)
