import os
import shutil
import glob
import re

BASE_DIR = "/home/tensorttx/Projects/Personal/AURA_CHAT/AURA_CHAT/backend/core"
TF_DIR = os.path.join(BASE_DIR, "thought_field")

# Create directories
dirs = [
    "self_model", "environment", "ecology", "relationships", "presence",
    "reconsolidation", "incubation", "metacognition", "predictive", "social",
    "interfaces", "telemetry", "persistence"
]

for d in dirs:
    os.makedirs(os.path.join(TF_DIR, d), exist_ok=True)

# 1. Move SelfModel and Environment
if os.path.exists(os.path.join(BASE_DIR, "self_model")):
    for f in glob.glob(os.path.join(BASE_DIR, "self_model", "*.py")):
        shutil.move(f, os.path.join(TF_DIR, "self_model"))
    shutil.rmtree(os.path.join(BASE_DIR, "self_model"))

if os.path.exists(os.path.join(BASE_DIR, "environment")):
    for f in glob.glob(os.path.join(BASE_DIR, "environment", "*.py")):
        shutil.move(f, os.path.join(TF_DIR, "environment"))
    shutil.rmtree(os.path.join(BASE_DIR, "environment"))

# 2. Move existing TF files
moves = {
    "Ecology.py": "ecology",
    "ThoughtGraph.py": "ecology",
    "ThoughtNode.py": "ecology",
    "ThoughtState.py": "ecology",
    "ThoughtAffinity.py": "ecology",
    "ThoughtRelationship.py": "relationships",
    "CognitivePresence.py": "presence",
    "ThoughtInterpretation.py": "reconsolidation",
    "IncubationSeed.py": "incubation",
    "Insight.py": "incubation",
    "NodeTelemetry.py": "telemetry",
    "NodePersistence.py": "persistence"
}

for file, folder in moves.items():
    src = os.path.join(TF_DIR, file)
    if os.path.exists(src):
        shutil.move(src, os.path.join(TF_DIR, folder, file))

# Write CognitiveContext.py
with open(os.path.join(TF_DIR, "CognitiveContext.py"), "w") as f:
    f.write("""from dataclasses import dataclass, field
import time
from typing import Optional, Dict

@dataclass
class CognitiveContext:
    session_id: str
    transcript: str
    current_time: float = field(default_factory=time.time)
    conversation_metadata: Dict = field(default_factory=dict)
    runtime_signals: Dict = field(default_factory=dict)
""")

# Write CognitiveEvents.py
with open(os.path.join(TF_DIR, "CognitiveEvents.py"), "w") as f:
    f.write("""class CognitiveEvents:
    pass
""")

# Write CognitiveSnapshotBuilder.py
with open(os.path.join(TF_DIR, "CognitiveSnapshotBuilder.py"), "w") as f:
    f.write("""class CognitiveSnapshotBuilder:
    @staticmethod
    def build(self_state, env_state, ecology, presence):
        # Fallback to existing for now
        lines = []
        dominant = sorted([n for n in ecology.graph.nodes.values() if n.energy > 0.6], key=lambda x: x.energy, reverse=True)
        if dominant:
            lines.append(f"Current Focus: {dominant[0].type.upper()} ({dominant[0].interpretations[-1].content[:30]}...)")
        
        bias = presence.get_bias_string()
        if bias:
            lines.append(f"Behavioral Bias: {bias}")
            
        return " | ".join(lines) if lines else "Mind is quiet."
""")

# Write CognitiveConfiguration.py
with open(os.path.join(TF_DIR, "CognitiveConfiguration.py"), "w") as f:
    f.write("""class CognitiveConfiguration:
    pass
""")

# Write AssociativeThoughtField.py
with open(os.path.join(TF_DIR, "AssociativeThoughtField.py"), "w") as f:
    f.write("""from .CognitiveContext import CognitiveContext
from .self_model.SelfModel import SelfModel
from .environment.Environment import Environment
from .ecology.Ecology import Ecology
from .CognitiveSnapshotBuilder import CognitiveSnapshotBuilder

class AssociativeThoughtField:
    _instances = {}

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.self_model = SelfModel.get_instance(session_id)
        self.environment = Environment.get_instance(session_id)
        self.ecology = Ecology.get_instance(session_id)

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
        
        # Build Snapshot
        return CognitiveSnapshotBuilder.build(self_state, env_state, self.ecology, self.ecology.presence)
""")

# Update pipeline.py
pipeline_file = os.path.join(BASE_DIR, "pipeline.py")
with open(pipeline_file, "r") as f:
    content = f.read()

# Replace old imports
content = re.sub(r'from backend.core.self_model import SelfModel\n', '', content)
content = re.sub(r'from backend.core.environment import Environment\n', '', content)
content = re.sub(r'from backend.core.thought_field import Ecology\n', 'from backend.core.thought_field.AssociativeThoughtField import AssociativeThoughtField\nfrom backend.core.thought_field.CognitiveContext import CognitiveContext\n', content)

# Replace Step 4.1, 4.2, 4.3 with ATF
old_logic = """    # ── Step 4.1: Living Self Model ──────────────────────────────────────────
    self_model = SelfModel.get_instance(session_id)
    self_state = self_model.update(turn_data)

    # ── Step 4.2: Environmental Ecology ──────────────────────────────────────
    environment = Environment.get_instance(session_id)
    env_state = environment.tick(self_state)

    # ── Step 4.3: Thought Ecology ────────────────────────────────────────────
    ecology = Ecology.get_instance(session_id)
    if user_text:
        ecology.ingest(user_text, "semantic", {"attention": 1.0, "urgency": 0.5})
    ecology.tick(env_state.fields, self_state)
    cog_snapshot = ecology.get_cognitive_snapshot()

    combined_injection = sensing_injection + (vocab_injection or "") + f"\\n\\n{self_state.to_prompt_injection()}\\n\\n{cog_snapshot}\""""

new_logic = """    # ── Step 4.1-4.3: Associative Thought Field (ATF) ────────────────────────
    atf = AssociativeThoughtField.get_instance(session_id)
    ctx = CognitiveContext(
        session_id=session_id,
        transcript=user_text,
        conversation_metadata=turn_data
    )
    cog_snapshot = atf.tick(ctx)
    self_prompt = atf.self_model.get_state().to_prompt_injection()
    combined_injection = sensing_injection + (vocab_injection or "") + f"\\n\\n{self_prompt}\\n\\n{cog_snapshot}\""""

content = content.replace(old_logic, new_logic)

with open(pipeline_file, "w") as f:
    f.write(content)

print("Refactor completed.")
