"""
AURA Relationship Stage Model

Tracks how well AURA "knows" each user and modifies behavior accordingly.
Day 1 users get gentle exploration. Day 100 users get familiar, abbreviated interaction.

Stages are monotonically non-decreasing: you don't un-know someone.

Persistence:
  - Primary: Redis cache 'aura:rel:{user_id}' (TTL 24h)
  - Durable: aura_storage table in Supabase (key='relationship_profile')
  - Computation: <5ms (pure arithmetic, no ML)
"""

import json
import time
import asyncio
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional
from backend.infrastructure.logging import get_logger

logger = get_logger("relationship")


# ═══════════════════════════════════════════════════════════════════
# STAGES
# ═══════════════════════════════════════════════════════════════════

class RelationshipStage(str, Enum):
    STRANGER = "stranger"           # Sessions 0-3:  Curious, gentle, asks basic questions
    ACQUAINTANCE = "acquaintance"   # Sessions 4-10: Remembers basics, slightly warmer
    FAMILIAR = "familiar"           # Sessions 11-30: Comfortable, uses callbacks, shorter
    CLOSE = "close"                 # Sessions 31-100: Intimate, abbreviated, inside references
    INTIMATE = "intimate"           # Sessions 100+: Deep familiarity, almost telepathic

    @property
    def rank(self) -> int:
        """Ordinal for monotonic enforcement."""
        return list(RelationshipStage).index(self)


# ═══════════════════════════════════════════════════════════════════
# PROFILE
# ═══════════════════════════════════════════════════════════════════

@dataclass
class RelationshipProfile:
    stage: RelationshipStage
    session_count: int
    total_turns: int
    avg_trust: float
    avg_session_duration_minutes: float
    first_seen: str       # ISO timestamp
    last_seen: str        # ISO timestamp
    days_known: int

    def to_prompt_injection(self) -> str:
        """
        Compact injection for Layer 3 context XML.
        Includes both the stage label and a behavioral directive
        so Gemini knows HOW to adjust.
        """
        stage_directives = {
            RelationshipStage.STRANGER:
                "Be curious and warm. Ask open-ended questions. Don't assume familiarity.",
            RelationshipStage.ACQUAINTANCE:
                "Show you remember past conversations. Slightly warmer tone.",
            RelationshipStage.FAMILIAR:
                "Comfortable and natural. Use shorter responses. Reference shared history.",
            RelationshipStage.CLOSE:
                "Speak like a close friend. Abbreviated, warm, use their patterns. Skip pleasantries.",
            RelationshipStage.INTIMATE:
                "Near-telepathic familiarity. Finish their thoughts. Reference old memories naturally.",
        }
        directive = stage_directives[self.stage]
        return (
            f' rel="{self.stage.value}" sessions="{self.session_count}" '
            f'days="{self.days_known}" rel_hint="{directive}"'
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        d["stage"] = self.stage.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "RelationshipProfile":
        d = d.copy()
        d["stage"] = RelationshipStage(d["stage"])
        return cls(**d)

    @classmethod
    def default(cls) -> "RelationshipProfile":
        """New user with no data."""
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return cls(
            stage=RelationshipStage.STRANGER,
            session_count=0,
            total_turns=0,
            avg_trust=0.3,
            avg_session_duration_minutes=0.0,
            first_seen=now,
            last_seen=now,
            days_known=0,
        )


# ═══════════════════════════════════════════════════════════════════
# STAGE COMPUTATION
# ═══════════════════════════════════════════════════════════════════

def compute_stage(
    session_count: int,
    avg_trust: float,
    days_known: int,
) -> RelationshipStage:
    """
    Stage depends on session count, trust level, AND time known.
    High session count but low trust = still acquaintance (frequent but shallow).
    Low session count but high trust = can advance faster (deep conversations).

    Computation: pure arithmetic, <1ms.
    """
    # Trust bonus: high trust accelerates progression (0-5 effective sessions)
    trust_boost = max(0.0, (avg_trust - 0.5) * 10)

    # Time bonus: knowing someone longer counts (0-5, max at 5 weeks)
    time_boost = min(5.0, days_known / 7)

    effective_sessions = session_count + trust_boost + time_boost

    if effective_sessions < 4:
        return RelationshipStage.STRANGER
    if effective_sessions < 12:
        return RelationshipStage.ACQUAINTANCE
    if effective_sessions < 35:
        return RelationshipStage.FAMILIAR
    if effective_sessions < 110:
        return RelationshipStage.CLOSE
    return RelationshipStage.INTIMATE


# ═══════════════════════════════════════════════════════════════════
# TRACKER
# ═══════════════════════════════════════════════════════════════════

REDIS_KEY_PREFIX = "aura:rel:"
REDIS_TTL = 86400  # 24 hours


class RelationshipTracker:
    """
    Load, compute, and persist relationship profiles.

    Cache hierarchy:
      1. Redis (fast, TTL 24h)
      2. Supabase aura_storage (durable)
      3. Default profile (new user)
    """

    def __init__(self, redis_client=None, supabase_client=None):
        self._redis = redis_client
        self._supabase = supabase_client

    async def get_profile(self, user_id: str) -> RelationshipProfile:
        """Load or create a relationship profile for the user."""
        # 1. Try Redis cache
        profile = await self._load_from_redis(user_id)
        if profile:
            return profile

        # 2. Try Supabase
        profile = await self._load_from_supabase(user_id)
        if profile:
            await self._cache_to_redis(user_id, profile)
            return profile

        # 3. Default for new users
        return RelationshipProfile.default()

    async def increment_session(self, user_id: str, session_duration_minutes: float = 0.0) -> RelationshipProfile:
        """
        Called at session start. Increments count, updates last_seen,
        recomputes stage (monotonically — never decreases).
        """
        profile = await self.get_profile(user_id)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        profile.session_count += 1
        profile.last_seen = now

        # Compute days known
        try:
            from datetime import datetime
            first = datetime.fromisoformat(profile.first_seen.replace("Z", "+00:00"))
            last = datetime.fromisoformat(now.replace("Z", "+00:00"))
            profile.days_known = max(0, (last - first).days)
        except Exception:
            pass

        # Update avg session duration (running average)
        if session_duration_minutes > 0 and profile.session_count > 0:
            profile.avg_session_duration_minutes = (
                (profile.avg_session_duration_minutes * (profile.session_count - 1) + session_duration_minutes)
                / profile.session_count
            )

        # Recompute stage (monotonically non-decreasing)
        new_stage = compute_stage(profile.session_count, profile.avg_trust, profile.days_known)
        if new_stage.rank > profile.stage.rank:
            old = profile.stage.value
            profile.stage = new_stage
            logger.info(
                "Relationship stage change: %s → %s (user=%s, sessions=%d, days=%d)",
                old, new_stage.value, user_id[:8], profile.session_count, profile.days_known,
            )

        # Persist
        await self._persist(user_id, profile)
        return profile

    async def update_trust(self, user_id: str, trust_value: float) -> RelationshipProfile:
        """
        Called per turn. Updates running average trust.
        Recomputes stage if trust change pushes over a threshold.
        Returns the updated profile so callers don't need a separate get_profile() call.
        """
        profile = await self.get_profile(user_id)
        n = max(1, profile.total_turns)
        profile.avg_trust = (profile.avg_trust * n + trust_value) / (n + 1)
        profile.total_turns += 1

        # Check for stage advancement
        new_stage = compute_stage(profile.session_count, profile.avg_trust, profile.days_known)
        if new_stage.rank > profile.stage.rank:
            old = profile.stage.value
            profile.stage = new_stage
            logger.info(
                "relationship_stage_change",
                trigger="trust",
                old_stage=old,
                new_stage=new_stage.value,
                user_id=user_id[:8],
            )

        await self._persist(user_id, profile)
        return profile

    # ── Persistence layer ────────────────────────────────────────

    async def _load_from_redis(self, user_id: str) -> Optional[RelationshipProfile]:
        if not self._redis:
            return None
        try:
            raw = await self._redis.get(f"{REDIS_KEY_PREFIX}{user_id}")
            if raw:
                return RelationshipProfile.from_dict(json.loads(raw))
        except Exception as e:
            logger.debug("Redis load failed: %s", e)
        return None

    async def _load_from_supabase(self, user_id: str) -> Optional[RelationshipProfile]:
        if not self._supabase:
            return None
        try:
            result = await asyncio.to_thread(
                lambda: self._supabase.table("aura_storage").select("data").eq(
                    "user_id", user_id
                ).eq("key", "relationship_profile").execute()
            )
            if result.data and len(result.data) > 0:
                return RelationshipProfile.from_dict(result.data[0]["data"])
        except Exception as e:
            logger.debug("Supabase load failed: %s", e)
        return None

    async def _cache_to_redis(self, user_id: str, profile: RelationshipProfile) -> None:
        if not self._redis:
            return
        try:
            await self._redis.set(
                f"{REDIS_KEY_PREFIX}{user_id}",
                json.dumps(profile.to_dict()),
                ex=REDIS_TTL,
            )
        except Exception:
            pass

    async def _persist(self, user_id: str, profile: RelationshipProfile) -> None:
        """Write to both Redis (cache) and Supabase (durable)."""
        await self._cache_to_redis(user_id, profile)

        if self._supabase:
            try:
                await asyncio.to_thread(
                    lambda: self._supabase.table("aura_storage").upsert({
                        "user_id": user_id,
                        "key": "relationship_profile",
                        "data": profile.to_dict(),
                        "updated_at": profile.last_seen,
                    }, on_conflict="user_id,key").execute()
                )
            except Exception as e:
                logger.warning("Supabase persist failed: %s", e)
