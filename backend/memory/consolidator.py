"""
Memory Consolidation Pipeline

Run periodically (daily cron or manual) to compress old turn-level memories
into episode summaries. Reduces storage, improves retrieval quality.

Before: 500 individual turns → 500 pgvector rows
After:  500 turns → ~30 episode summaries → ~30 pgvector rows (~17x reduction)

Table: aura_chroma_backup
Soft-delete: consolidated_at column (turn rows kept 30 days, then purgeable)
Idempotent: consolidated rows carry metadata.type='consolidated_episode';
             turns that already have consolidated_at are skipped on re-run.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from collections import defaultdict

from backend.infrastructure.logging import get_logger

log = get_logger("memory_consolidator")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Episode:
    session_id: str
    user_id: str
    turns: list[dict] = field(default_factory=list)

    @property
    def start_time(self) -> datetime:
        return _parse_ts(self.turns[0].get("created_at", ""))

    @property
    def end_time(self) -> datetime:
        return _parse_ts(self.turns[-1].get("created_at", ""))

    @property
    def duration_minutes(self) -> float:
        delta = (self.end_time - self.start_time).total_seconds()
        return max(delta, 0) / 60

    @property
    def peak_tension(self) -> float:
        return max(
            (t.get("metadata", {}) or {}).get("tension", 0.0) for t in self.turns
        )

    @property
    def avg_energy(self) -> float:
        energies = [(t.get("metadata", {}) or {}).get("energy", 0.0) for t in self.turns]
        return sum(energies) / len(energies) if energies else 0.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_ts(ts_str: str) -> datetime:
    """Parse ISO timestamp string to datetime (UTC, naive)."""
    if not ts_str:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


# ---------------------------------------------------------------------------
# Core consolidator
# ---------------------------------------------------------------------------

class MemoryConsolidator:
    """
    Groups eligible turn-level memories into episode summaries.

    Args:
        supabase_client: Supabase sync client (supabase-py).
        embedding_fn:    Async callable (text: str) -> list[float] (768-dim).
    """

    MIN_TURNS_PER_EPISODE = 5   # Skip tiny sessions
    MIN_AGE_DAYS = 7            # Only consolidate memories older than 7 days
    SUMMARY_MAX_CHARS = 300     # Keep summaries concise

    def __init__(self, supabase_client, embedding_fn):
        self.supabase = supabase_client
        self.embed = embedding_fn  # async fn(text) -> list[float]

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def consolidate_user(self, user_id: str, dry_run: bool = False) -> dict:
        """
        Consolidate all eligible turn-level memories for a user.

        Returns:
            dict with keys: user_id, episodes_created, turns_consolidated, errors, dry_run
        """
        cutoff = datetime.utcnow() - timedelta(days=self.MIN_AGE_DAYS)
        memories = await self._fetch_old_memories(user_id, cutoff)

        if not memories:
            log.info("no_eligible_memories", user_id=user_id)
            return {
                "user_id": user_id,
                "episodes_created": 0,
                "turns_consolidated": 0,
                "errors": 0,
                "dry_run": dry_run,
            }

        episodes = self._group_into_episodes(user_id, memories)
        stats = {"episodes_created": 0, "turns_consolidated": 0, "errors": 0}

        for episode in episodes:
            if len(episode.turns) < self.MIN_TURNS_PER_EPISODE:
                log.debug(
                    "episode_too_small",
                    session_id=episode.session_id,
                    turns=len(episode.turns),
                )
                continue

            try:
                summary = await self._summarize_episode(episode)

                if dry_run:
                    log.info(
                        "dry_run_episode",
                        session_id=episode.session_id,
                        turns=len(episode.turns),
                        preview=summary[:80],
                    )
                    stats["episodes_created"] += 1
                    stats["turns_consolidated"] += len(episode.turns)
                    continue

                embedding = await self.embed(summary)

                await self._insert_consolidated(
                    user_id,
                    summary,
                    embedding,
                    episode,
                )

                turn_ids = [t["id"] for t in episode.turns]
                await self._soft_delete_turns(turn_ids)

                stats["episodes_created"] += 1
                stats["turns_consolidated"] += len(episode.turns)

            except Exception as exc:
                log.error(
                    "episode_consolidation_failed",
                    session_id=episode.session_id,
                    error=str(exc),
                )
                stats["errors"] += 1

        log.info("consolidation_complete", user_id=user_id, dry_run=dry_run, **stats)
        return {"user_id": user_id, "dry_run": dry_run, **stats}

    async def purge_old_memories(self, days: int = 30) -> int:
        """Permanently delete soft-deleted memories older than N days."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        try:
            res = await (self.supabase.table("aura_chroma_backup")
                .delete()
                .lt("consolidated_at", cutoff.isoformat())
                .execute())
            count = len(res.data) if res.data else 0
            log.info("memories_purged", count=count, older_than_days=days)
            return count
        except Exception as e:
            log.error("purge_failed", error=str(e))
            return 0

    # ------------------------------------------------------------------
    # Private: data access
    # ------------------------------------------------------------------

    async def _fetch_old_memories(self, user_id: str, cutoff: datetime) -> list[dict]:
        """
        Fetch turn-level (type='turn') memories older than cutoff
        that have NOT yet been soft-deleted (consolidated_at IS NULL).
        """
        try:
            result = await (
                self.supabase
                .table("aura_chroma_backup")
                .select("id, session_id, user_id, turn_text, metadata, created_at")
                .eq("user_id", user_id)
                .is_("consolidated_at", "null")
                .lt("created_at", cutoff.isoformat())
                .order("created_at", desc=False)
                .execute()
            )
            rows = result.data or []
            # Exclude rows that are already consolidated episodes
            return [
                r for r in rows
                if (r.get("metadata") or {}).get("type") != "consolidated_episode"
            ]
        except Exception as exc:
            log.error("fetch_memories_failed", user_id=user_id, error=str(exc))
            return []

    async def _insert_consolidated(
        self,
        user_id: str,
        summary: str,
        embedding: list[float],
        episode: Episode,
    ) -> None:
        """Insert one consolidated episode row into aura_chroma_backup."""
        await self.supabase.table("aura_chroma_backup").insert({
            "user_id": user_id,
            "session_id": episode.session_id,
            "turn_text": summary,
            "embedding": embedding,
            "embedding_id": f"{episode.session_id}_consolidated",
            "created_at": episode.start_time.isoformat(),
            "metadata": {
                "type": "consolidated_episode",
                "user_id": user_id,
                "session_id": episode.session_id,
                "turn_count": len(episode.turns),
                "duration_minutes": round(episode.duration_minutes, 1),
                "peak_tension": round(episode.peak_tension, 2),
                "avg_energy": round(episode.avg_energy, 2),
                "start_time": episode.start_time.isoformat(),
                "end_time": episode.end_time.isoformat(),
            },
        }).execute()

    async def _soft_delete_turns(self, turn_ids: list[str]) -> None:
        """Stamp consolidated_at on original turn rows (soft-delete)."""
        if not turn_ids:
            return
        now_iso = datetime.utcnow().isoformat()
        await self.supabase.table("aura_chroma_backup").update({
            "consolidated_at": now_iso,
        }).in_("id", turn_ids).execute()

    # ------------------------------------------------------------------
    # Private: grouping + summarisation
    # ------------------------------------------------------------------

    def _group_into_episodes(self, user_id: str, memories: list[dict]) -> list[Episode]:
        """Group memory rows by session_id, preserving chronological order."""
        buckets: dict[str, list[dict]] = defaultdict(list)
        for row in memories:
            buckets[row.get("session_id", "unknown")].append(row)

        episodes = []
        for session_id, turns in buckets.items():
            turns.sort(key=lambda r: r.get("created_at", ""))
            episodes.append(Episode(session_id=session_id, user_id=user_id, turns=turns))
        return episodes

    async def _summarize_episode(self, episode: Episode) -> str:
        """
        v2 — async Gemini Flash call for a narrative summary.
        Falls back to template on failure.
        """
        import asyncio
        from google import genai
        
        texts = [t.get("turn_text", "") for t in episode.turns]
        date_str = episode.start_time.strftime("%b %d")

        try:
            conversation = "\n".join([f"- {text}" for text in texts])
            prompt = (
                f"Summarize this user's conversation from {date_str} in 2-3 sentences. "
                "Write in the first-person perspective of an observer (e.g., 'The user talked about...'). "
                "Focus on the core meaning, emotional arc, and key subjects. "
                "Keep it under 300 characters.\n\n"
                f"{conversation}"
            )
            
            client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
            response = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-1.5-flash",
                contents=prompt
            )
            summary = response.text.strip()
            if summary:
                return summary[: self.SUMMARY_MAX_CHARS]
        except Exception as e:
            log.warning("llm_summary_failed", error=str(e))

        # Fallback to v1 template if LLM fails
        first = texts[0][:100].replace("'", "\u2018")
        last = texts[-1][:100].replace("'", "\u2018")

        tensions = [(t.get("metadata") or {}).get("tension", 0.0) for t in episode.turns]
        peak_idx = tensions.index(max(tensions)) if tensions else 0
        peak = texts[peak_idx][:100].replace("'", "\u2018")

        summary = (
            f"Session on {date_str}: "
            f"Started with \u2018{first}\u2019. "
            f"Key moment: \u2018{peak}\u2019. "
            f"Ended with \u2018{last}\u2019. "
            f"Duration: {episode.duration_minutes:.0f}min, "
            f"peak tension: {episode.peak_tension:.1f}, "
            f"avg energy: {episode.avg_energy:.1f}."
        )

        return summary[: self.SUMMARY_MAX_CHARS]
