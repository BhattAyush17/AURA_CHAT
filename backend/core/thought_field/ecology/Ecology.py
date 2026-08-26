import time
import uuid
from .ThoughtGraph import ThoughtGraph
from ..persistence.NodePersistence import NodePersistence
from ..telemetry.NodeTelemetry import NodeTelemetry
from .ThoughtNode import ThoughtNode
from .ThoughtAffinity import ThoughtAffinity
from backend.core.thought_field.self_model import SelfState
from ..presence.CognitivePresence import CognitivePresence

class Ecology:
    _instances = {}
    _persistence = NodePersistence()

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.graph, self.presence = self._persistence.load(session_id)
        self.last_tick = time.time()

    @classmethod
    def get_instance(cls, session_id: str) -> 'Ecology':
        if session_id not in cls._instances:
            cls._instances[session_id] = cls(session_id)
        return cls._instances[session_id]

    def ingest(self, content: str, node_type: str, affinity_kwargs: dict):
        # 1. Ask: Does this deserve a new representation?
        # A crude semantic check (in production, use embeddings).
        # We search existing active thoughts to see if we should just reshape them.
        for node in self.graph.nodes.values():
            if content.lower() in node.interpretations[-1].content.lower() or node.interpretations[-1].content.lower() in content.lower():
                # Just strengthen existing thought (reshape instead of multiply)
                node.energy = min(1.0, node.energy + 0.3)
                node.last_updated = time.time()
                return
                
        # 2. Only if truly novel, create a new node (natural scarcity)
        node_id = str(uuid.uuid4())
        affinity = ThoughtAffinity(**affinity_kwargs)
        node = ThoughtNode(node_id, content, node_type, affinity)
        node.energy = 0.8 # Starts with high energy
        self.graph.add_node(node)

    def tick(self, env_fields: dict, self_state: SelfState):
        self.presence.tick()
        self.graph.tick(env_fields, self_state, self.presence)
        
        self._persistence.save(self.session_id, self.graph, self.presence)
        NodeTelemetry.emit(self.session_id, self.graph, self.presence)
        
    def get_cognitive_snapshot(self) -> str:
        # Prevent leaking raw node IDs or exact thought text to the execution layer
        # The frontend should infer behavior from emergent themes, not direct thoughts.
        dominant = self.graph.get_dominant_nodes()
        echoes = self.graph.get_echo_nodes()
        
        if not dominant and not echoes:
            return ""
            
        lines = []
        if dominant:
            lines.append(f"Current Focus: {dominant[0].type.upper()} ({dominant[0].interpretations[-1].content[:30]}...)")
            if len(dominant) > 1:
                lines.append(f"Internal Tension: Pulled towards {dominant[1].type.upper()}")
                
        # Inject Presence/Residue pressures instead of Echoes
        if self.presence.pressures["attention"] > 0.3:
            lines.append(f"Attention Bias: High residual attention ({self.presence.pressures['attention']:.2f})")
        if self.presence.pressures["reflection"] > 0.4:
            lines.append(f"Reflection Pressure: High reflection carryover ({self.presence.pressures['reflection']:.2f})")
        if self.presence.pressures["relationship"] > 0.3:
            lines.append(f"Relationship Pressure: High residual connection ({self.presence.pressures['relationship']:.2f})")
            
        strong_rels = [r for r in self.graph.relationships.values() if r.strength > 0.7]
        if strong_rels:
            lines.append(f"Relationship Climate: {len(strong_rels)} active internal connections")
            
        if any(r.tension > 0.5 for r in self.graph.relationships.values()):
            lines.append("Identity Pressure: High internal relationship tension")
            
        return "[COGNITIVE_SNAPSHOT]\n" + "\n".join(lines) + "\n[/COGNITIVE_SNAPSHOT]"
