"""
AURA Proactive Engagement Engine

Determines if and when AURA should speak unprompted. Three trigger types:
  1. SILENCE_CHECKIN  — User quiet for >45s during active session
  2. EMOTIONAL_FOLLOWUP — High-tension moment 3+ turns ago, now calm
  3. RETURN_GREETING — First session after >24h gap

Design:
  - Stateless except for Redis timestamps (fire-and-forget writes)
  - Rate-limited: max 1 proactive action per 2 minutes
  - After 3 minutes of silence, stops checking (user probably left)
  - All inject_text is system-like context — never shown to user
  - Failures are silently swallowed (proactive is optional)
"""

import json
import time
from enum import Enum
from dataclasses import dataclass
from typing import Optional
from backend.infrastructure.logging import get_logger

logger = get_logger("proactive")


# ═══════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════

class ProactiveType(str, Enum):
    SILENCE_CHECKIN = "silence_checkin"
    EMOTIONAL_FOLLOWUP = "emotional_followup"
    RETURN_GREETING = "return_greeting"


@dataclass
class ProactiveAction:
    type: ProactiveType
    inject_text: str            # Text to inject via sendClientContent
    min_delay_since_last: int   # Minimum seconds since last proactive action
    priority: int               # Higher = more important


# ═══════════════════════════════════════════════════════════════════
# RATE LIMITING
# ═══════════════════════════════════════════════════════════════════

RATE_LIMIT_SECONDS = 120        # Max 1 proactive action per 2 minutes
RATE_LIMIT_TTL = 300            # Redis key TTL (cleanup)
SILENCE_MIN_SECONDS = 45        # Minimum silence before check-in
SILENCE_MAX_SECONDS = 180       # Stop checking after 3 minutes
FOLLOWUP_COOLDOWN_TURNS = 3     # Turns after peak tension before follow-up


# ═══════════════════════════════════════════════════════════════════
# ENGINE
# ═══════════════════════════════════════════════════════════════════

class ProactiveEngine:
    """Determines if and when AURA should speak unprompted."""

    def __init__(self, redis_client):
        self.redis = redis_client

    async def check(self, session_id: str, user_id: str) -> Optional[ProactiveAction]:
        """
        Check if any proactive trigger should fire.
        Returns highest priority action or None.
        """
        if not self.redis:
            return None

        # Return greeting bypasses rate limit (it's one-shot, self-consuming)
        rg = await self._check_return_greeting(session_id, user_id)
        if rg:
            logger.info(
                "Proactive trigger: %s (session=%s)",
                rg.type.value, session_id[:8],
            )
            return rg

        # Rate limit other proactive actions
        try:
            last_raw = await self.redis.get(f"aura:proactive:last:{session_id}")
            if last_raw and (time.time() - float(last_raw)) < RATE_LIMIT_SECONDS:
                return None
        except Exception:
            return None

        # Check remaining triggers in priority order
        action = (
            await self._check_emotional_followup(session_id, user_id)
            or await self._check_silence(session_id)
        )

        if action:
            try:
                await self.redis.set(
                    f"aura:proactive:last:{session_id}",
                    str(time.time()),
                    ex=RATE_LIMIT_TTL,
                )
            except Exception:
                pass
            logger.info(
                "Proactive trigger: %s (session=%s)",
                action.type.value, session_id[:8],
            )

        return action

    async def _check_silence(self, session_id: str) -> Optional[ProactiveAction]:
        """If user has been silent for >45s during an active session."""
        try:
            last_activity = await self.redis.get(f"aura:last_activity:{session_id}")
            if not last_activity:
                return None
            elapsed = time.time() - float(last_activity)

            if SILENCE_MIN_SECONDS < elapsed < SILENCE_MAX_SECONDS:
                return ProactiveAction(
                    type=ProactiveType.SILENCE_CHECKIN,
                    inject_text=(
                        "[SYSTEM: User has been quiet for a moment. "
                        "Gently check in with a brief, warm comment. "
                        "Don't ask 'are you there?' or 'are you okay?'. "
                        "Instead, share a small thought or observation. "
                        "Keep it to 1 sentence. Sound natural, not robotic.]"
                    ),
                    min_delay_since_last=120,
                    priority=1,
                )
        except Exception:
            pass
        return None

    async def _check_emotional_followup(
        self, session_id: str, user_id: str
    ) -> Optional[ProactiveAction]:
        """
        If there was a high-tension moment 3+ turns ago and tension has
        since dropped — offer a gentle follow-up referencing what they shared.
        """
        try:
            cached_raw = await self.redis.get(f"aura:analysis:{session_id}")
            if not cached_raw:
                return None
            cached = json.loads(cached_raw)

            sensing = cached.get("sensing_state", {})
            current_tension = sensing.get("tension", 0)
            session_turn = sensing.get("session_turn", 0)

            # Check for stored peak tension marker
            peak_raw = await self.redis.get(f"aura:peak_tension:{session_id}")
            if not peak_raw:
                # No peak recorded — check if current tension is peaking
                if current_tension > 0.7:
                    await self.redis.set(
                        f"aura:peak_tension:{session_id}",
                        json.dumps({
                            "tension": current_tension,
                            "turn": session_turn,
                            "ts": time.time(),
                        }),
                        ex=7200,
                    )
                return None

            peak = json.loads(peak_raw)
            peak_tension = peak.get("tension", 0)
            peak_turn = peak.get("turn", 0)
            turns_since_peak = session_turn - peak_turn

            if (
                peak_tension > 0.7
                and current_tension < 0.4
                and turns_since_peak >= FOLLOWUP_COOLDOWN_TURNS
            ):
                # Clear the peak so we don't fire again
                await self.redis.delete(f"aura:peak_tension:{session_id}")
                return ProactiveAction(
                    type=ProactiveType.EMOTIONAL_FOLLOWUP,
                    inject_text=(
                        "[SYSTEM: Earlier in this conversation, the user expressed "
                        "something heavy. The mood has calmed now. If it feels "
                        "natural, gently reference what they shared earlier — "
                        "show you were listening and it mattered. "
                        "Don't force it. 1-2 sentences max.]"
                    ),
                    min_delay_since_last=300,
                    priority=2,
                )
        except Exception:
            pass
        return None

    async def _check_return_greeting(
        self, session_id: str, user_id: str
    ) -> Optional[ProactiveAction]:
        """
        First message of a new session after >24h gap.
        Checks if a return greeting flag was set during session start.
        """
        try:
            flag = await self.redis.get(f"aura:return_greeting:{session_id}")
            if not flag:
                return None

            # Consume the flag so it only fires once
            await self.redis.delete(f"aura:return_greeting:{session_id}")

            gap_hours = float(flag)
            if gap_hours >= 24:
                warmth = "It's been a while" if gap_hours > 168 else "Good to see you again"
                return ProactiveAction(
                    type=ProactiveType.RETURN_GREETING,
                    inject_text=(
                        f"[SYSTEM: This user is returning after {int(gap_hours)} hours. "
                        f"{warmth}. Reference something from past conversations if you "
                        "remember. Be warm but not overwhelming. "
                        "Don't say 'welcome back' literally — be more natural than that.]"
                    ),
                    min_delay_since_last=0,
                    priority=3,
                )
        except Exception:
            pass
        return None

    # ── Activity tracking ────────────────────────────────────────

    async def record_activity(self, session_id: str) -> None:
        """Call on every user turn to update last activity timestamp."""
        if not self.redis:
            return
        try:
            await self.redis.set(
                f"aura:last_activity:{session_id}",
                str(time.time()),
                ex=7200,  # 2 hour TTL
            )
        except Exception:
            pass

    async def mark_return_greeting(
        self, session_id: str, gap_hours: float
    ) -> None:
        """
        Called at session start if user hasn't been seen in >24h.
        Sets a one-shot flag consumed by _check_return_greeting.
        """
        if not self.redis or gap_hours < 24:
            return
        try:
            await self.redis.set(
                f"aura:return_greeting:{session_id}",
                str(gap_hours),
                ex=3600,  # 1 hour TTL — resilient to server restarts/slow connects
            )
        except Exception:
            pass
