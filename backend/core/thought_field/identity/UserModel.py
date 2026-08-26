from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any
import time
import json

@dataclass
class Evidence:
    confidence: float
    recency: float
    source: str  # "explicit_statement", "repeated_behavior", "acoustic_signal", "music_behavior", "inference"
    supporting_observations: List[str] = field(default_factory=list)
    first_observed: float = field(default_factory=time.time)
    last_reinforced: float = field(default_factory=time.time)

@dataclass
class CandidateFact:
    topic: str
    content: str
    evidence: Evidence
    status: str = "CONSIDERATION"  # "THOUGHT", "CONSIDERATION", "INTENTION", "GOAL", "COMMITMENT"

@dataclass
class IdentityFact:
    topic: str
    content: str
    evidence: Evidence

@dataclass
class UnresolvedThread:
    topic: str
    content: str
    status: str = "ACTIVE" # ACTIVE, PROGRESSING, RESOLVED, ARCHIVED
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

@dataclass
class StableIdentity:
    stable_facts: List[IdentityFact] = field(default_factory=list)
    preferences: List[IdentityFact] = field(default_factory=list)
    interests: List[IdentityFact] = field(default_factory=list)
    goals: List[IdentityFact] = field(default_factory=list)

@dataclass
class CommunicationProfile:
    languages: List[str] = field(default_factory=list)
    code_switching: float = 0.0
    tone: str = "neutral"
    verbosity: str = "balanced"
    register: str = "ACQUAINTING"

@dataclass
class CurrentState:
    topic: Optional[str] = None
    goal: Optional[str] = None
    emotional_state: Optional[str] = None
    engagement: float = 0.5
    activity: Optional[str] = None
    last_updated: float = field(default_factory=time.time)

@dataclass
class RecentContext:
    active_topics: List[str] = field(default_factory=list)
    recent_events: List[str] = field(default_factory=list)
    unresolved_items: List[UnresolvedThread] = field(default_factory=list)

@dataclass
class RelationshipContext:
    familiarity: float = 0.0
    rapport: float = 0.0
    interaction_history: int = 0

@dataclass
class UserModelMetadata:
    processed_consolidations: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

@dataclass
class UserModel:
    user_id: str
    identity: StableIdentity = field(default_factory=StableIdentity)
    communication: CommunicationProfile = field(default_factory=CommunicationProfile)
    current_state: CurrentState = field(default_factory=CurrentState)
    recent_context: RecentContext = field(default_factory=RecentContext)
    relationship: RelationshipContext = field(default_factory=RelationshipContext)
    recent_changes: List[str] = field(default_factory=list)
    metadata: UserModelMetadata = field(default_factory=UserModelMetadata)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "UserModel":
        if not data:
            return None
            
        def _parse_evidence(e_data):
            return Evidence(**e_data) if isinstance(e_data, dict) else e_data

        def _parse_facts(facts_data):
            return [IdentityFact(f["topic"], f["content"], _parse_evidence(f["evidence"])) for f in facts_data]

        identity_data = data.get("identity", {})
        identity = StableIdentity(
            stable_facts=_parse_facts(identity_data.get("stable_facts", [])),
            preferences=_parse_facts(identity_data.get("preferences", [])),
            interests=_parse_facts(identity_data.get("interests", [])),
            goals=_parse_facts(identity_data.get("goals", []))
        )

        communication = CommunicationProfile(**data.get("communication", {}))
        current_state = CurrentState(**data.get("current_state", {}))
        
        recent_data = data.get("recent_context", {})
        unresolved = [UnresolvedThread(**u) if isinstance(u, dict) else UnresolvedThread(topic="legacy", content=u) for u in recent_data.get("unresolved_items", [])]
        recent_context = RecentContext(
            active_topics=recent_data.get("active_topics", []),
            recent_events=recent_data.get("recent_events", []),
            unresolved_items=unresolved
        )

        relationship = RelationshipContext(**data.get("relationship", {}))
        recent_changes = data.get("recent_changes", [])
        metadata = UserModelMetadata(**data.get("metadata", {}))

        return cls(
            user_id=data.get("user_id", ""),
            identity=identity,
            communication=communication,
            current_state=current_state,
            recent_context=recent_context,
            relationship=relationship,
            recent_changes=recent_changes,
            metadata=metadata
        )

    def synthesize_mental_model(self) -> str:
        """
        Creates a compact derived representation containing:
        - Active Goals
        - Core Identity Facts (high confidence)
        - Communication Profile
        - Unresolved Threads (Active)
        - Recent Changes
        """
        lines = []
        
        # Goals
        active_goals = [f"- {g.content}" for g in self.identity.goals if g.evidence.confidence > 0.5]
        if active_goals:
            lines.append("ACTIVE GOALS:\n" + "\n".join(active_goals))
            
        # Core Identity
        core_facts = [f"- {f.content}" for f in self.identity.stable_facts if f.evidence.confidence > 0.8]
        if core_facts:
            lines.append("CORE IDENTITY:\n" + "\n".join(core_facts[:5])) # Top 5
            
        # Preferences & Interests
        prefs = [f"- {p.content}" for p in self.identity.preferences if p.evidence.confidence > 0.7]
        if prefs:
            lines.append("PREFERENCES:\n" + "\n".join(prefs[:3]))
            
        # Unresolved
        active_threads = [f"- {t.content}" for t in self.recent_context.unresolved_items if t.status in ("ACTIVE", "PROGRESSING")]
        if active_threads:
            lines.append("UNRESOLVED THREADS:\n" + "\n".join(active_threads))
            
        # Recent changes
        if self.recent_changes:
            lines.append("RECENT CHANGES:\n" + "\n".join([f"- {c}" for c in self.recent_changes[-3:]]))
            
        return "\n\n".join(lines)
