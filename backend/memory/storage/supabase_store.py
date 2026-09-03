"""Storage adapters — the only place that knows how to talk to a memory store.

`MemoryStore` is the boundary the cognitive layer depends on. Swapping in a
different backend means writing one adapter, not touching retrieval, ranking,
or any provider code.

No prompt-generation logic lives here, and nothing here imports a frontend
concept.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional, Protocol

from backend.memory.core.contracts import (
    AUTHORITATIVE_TABLE,
    LIMITS,
    MemoryOutcome,
    MemoryRecord,
    MemoryTier,
    RetrievedMemory,
    monotonic_ms,
    now_iso,
)

# Messages Postgres/PostgREST use for a missing function. PostgREST says
# "Could not find the function ... in the schema cache" (PGRST202); Postgres
# itself says "function does not exist". Matching only one of the two is how an
# unapplied migration previously looked like a generic query failure.
_RPC_MISSING_MARKERS = (
    "could not find the function",
    "function does not exist",
    "pgrst202",
)
_UNAVAILABLE_MARKERS = (
    "connection",
    "timeout",
    "temporarily unavailable",
    "service unavailable",
    "bad gateway",
    "could not connect",
    "worker threw exception",
    "json could not be generated",
)


class StoreError(Exception):
    """Adapter-level failure classified into a memory outcome."""

    def __init__(self, outcome: MemoryOutcome, detail: str) -> None:
        super().__init__(detail)
        self.outcome = outcome
        self.detail = detail


def classify_exception(e: BaseException) -> StoreError:
    """Map a driver exception onto an explicit outcome.

    This is the single place where "something went wrong" becomes a specific,
    actionable state. Everything downstream branches on the outcome, never on
    string matching.
    """
    if isinstance(e, StoreError):
        return e
    if isinstance(e, asyncio.TimeoutError):
        return StoreError(MemoryOutcome.TIMEOUT, "operation timed out")
    msg = str(e)
    low = msg.lower()
    if any(m in low for m in _RPC_MISSING_MARKERS):
        return StoreError(MemoryOutcome.RPC_MISSING, msg[:400])
    if any(m in low for m in _UNAVAILABLE_MARKERS):
        return StoreError(MemoryOutcome.DATABASE_UNAVAILABLE, msg[:400])
    return StoreError(MemoryOutcome.DATABASE_UNAVAILABLE, msg[:400])


class MemoryStore(Protocol):
    """The storage contract. Implementations must be safe under concurrency
    and must bound every external call."""

    name: str

    async def is_available(self) -> bool: ...

    async def upsert(self, records: list[MemoryRecord]) -> tuple[int, int]:
        """Returns (written, duplicates_ignored). Must be idempotent on
        `embedding_id`."""

    async def existing_hashes(self, user_id: str, hashes: list[str]) -> set[str]: ...

    async def vector_search(
        self, *, user_id: str, embedding: list[float], count: int, threshold: float
    ) -> list[RetrievedMemory]: ...

    async def keyword_search(
        self, *, user_id: str, keywords: list[str], count: int, max_age_days: int
    ) -> list[RetrievedMemory]: ...


class SupabaseMemoryStore:
    """The authoritative store: Supabase Postgres + pgvector.

    Client lifecycle note — the client is *resolved* per call through a
    provider callable rather than captured at construction. The old modules
    did `from backend.api.main import supabase`, binding the import-time value
    `None` forever because the real client is only created in `startup_event`.
    Resolving late also means a reconnect is picked up without recreating this
    adapter.
    """

    name = "supabase"

    #: RPC signatures we know how to call, in preference order. `match_memories_v2`
    #: (migration 002) returns recency-weighted scores; `match_memories` (v1) is
    #: similarity-only. Probed at runtime — a missing v2 is a normal, handled state.
    _VECTOR_RPCS = ("match_memories_v2", "match_memories")

    def __init__(self, client_provider, *, table: str = AUTHORITATIVE_TABLE) -> None:
        self._client_provider = client_provider
        self._table = table
        self._rpc_cache: dict[str, bool] = {}

    # ── plumbing ─────────────────────────────────────────────────────
    def _client(self):
        client = self._client_provider()
        if client is None:
            raise StoreError(
                MemoryOutcome.DATABASE_UNAVAILABLE, "supabase client not initialized"
            )
        return client

    async def is_available(self) -> bool:
        try:
            self._client()
            return True
        except StoreError:
            return False

    @staticmethod
    async def _bounded(awaitable, timeout: float):
        try:
            return await asyncio.wait_for(awaitable, timeout=timeout)
        except asyncio.TimeoutError as e:
            raise StoreError(MemoryOutcome.TIMEOUT, f"exceeded {timeout}s") from e
        except Exception as e:
            raise classify_exception(e) from e

    def invalidate_rpc_cache(self) -> None:
        self._rpc_cache.clear()

    # ── writes ───────────────────────────────────────────────────────
    async def existing_hashes(self, user_id: str, hashes: list[str]) -> set[str]:
        """Which of these content hashes this user already has.

        Cross-device dedup lives here rather than in a per-process set, because
        Device B must see what Device A wrote.
        """
        if not hashes:
            return set()
        client = self._client()
        res = await self._bounded(
            client.table(self._table)
            .select("embedding_id")
            .eq("user_id", user_id)
            .in_("embedding_id", hashes)
            .execute(),
            LIMITS.vector_read_timeout_s,
        )
        rows = getattr(res, "data", None) or []
        return {r.get("embedding_id") for r in rows if r.get("embedding_id")}

    async def upsert(self, records: list[MemoryRecord]) -> tuple[int, int]:
        """Idempotent write.

        `aura_chroma_backup` has NO unique constraint on `embedding_id` — probed
        against the live database: two inserts with an identical `embedding_id`
        produced two rows, and `upsert` without `on_conflict` produced a third.
        So `ON CONFLICT` cannot be relied on for dedup; we read the existing
        hashes first and only insert the genuinely new rows. That makes repeated
        and concurrent requests converge instead of multiplying.
        """
        if not records:
            return (0, 0)
        client = self._client()
        user_ids = {r.user_id for r in records}

        already: set[str] = set()
        for uid in user_ids:
            already |= await self.existing_hashes(
                uid, [r.embedding_id for r in records if r.user_id == uid]
            )

        fresh: list[MemoryRecord] = []
        seen_in_batch: set[str] = set()
        for r in records:
            if r.embedding_id in already or r.embedding_id in seen_in_batch:
                continue
            seen_in_batch.add(r.embedding_id)
            fresh.append(r)

        duplicates = len(records) - len(fresh)
        if not fresh:
            return (0, duplicates)

        rows = []
        for r in fresh:
            row = r.to_row()
            row.setdefault("created_at", now_iso())
            rows.append(row)

        await self._bounded(
            client.table(self._table).insert(rows).execute(),
            LIMITS.write_timeout_s,
        )
        return (len(fresh), duplicates)

    # ── reads ────────────────────────────────────────────────────────
    async def vector_search(
        self, *, user_id: str, embedding: list[float], count: int, threshold: float
    ) -> list[RetrievedMemory]:
        """Try each known RPC signature; raise RPC_MISSING only when none exist.

        A missing v2 is cached so we do not pay a failed round-trip per turn,
        and `invalidate_rpc_cache()` lets the diagnostics surface re-probe after
        a migration is applied.
        """
        client = self._client()
        last_missing: Optional[StoreError] = None

        for rpc in self._VECTOR_RPCS:
            if self._rpc_cache.get(rpc) is False:
                continue
            args = self._rpc_args(rpc, user_id, embedding, count, threshold)
            try:
                res = await self._bounded(
                    client.rpc(rpc, args).execute(), LIMITS.vector_read_timeout_s
                )
            except StoreError as e:
                if e.outcome is MemoryOutcome.RPC_MISSING:
                    self._rpc_cache[rpc] = False
                    last_missing = e
                    continue
                raise
            self._rpc_cache[rpc] = True
            return [
                self._row_to_memory(row, rpc)
                for row in (getattr(res, "data", None) or [])
            ]

        raise last_missing or StoreError(
            MemoryOutcome.RPC_MISSING, "no vector RPC available"
        )

    @staticmethod
    def _rpc_args(
        rpc: str, user_id: str, embedding: list[float], count: int, threshold: float
    ) -> dict[str, Any]:
        if rpc == "match_memories_v2":
            return {
                "query_embedding": list(embedding),
                "p_user_id": user_id,
                "match_threshold": threshold,
                "match_count": count,
                "recency_weight": 0.15,
                "max_age_days": 365,
            }
        # v1: similarity only, and `match_user_id` must be passed — leaving it
        # NULL makes the RPC search every user's memories (001_add_hnsw_index.sql
        # documents NULL as "all users"), which would leak across accounts.
        return {
            "query_embedding": list(embedding),
            "match_user_id": user_id,
            "match_threshold": threshold,
            "match_count": count,
        }

    @staticmethod
    def _row_to_memory(row: dict[str, Any], rpc: str) -> RetrievedMemory:
        # v1 aliases the text column as `content`; v2 returns `turn_text`.
        # Reading only one name yielded "" for every row on the other RPC.
        text = row.get("turn_text") or row.get("content") or ""
        meta = row.get("metadata") or {}
        tier = meta.get("tier") if isinstance(meta, dict) else None
        similarity = float(row.get("similarity") or 0.0)
        return RetrievedMemory(
            text=text,
            similarity=similarity,
            tier=_coerce_tier(tier),
            metadata=meta if isinstance(meta, dict) else {},
            recency_score=float(row.get("recency_score") or 0.0),
            final_score=float(row.get("final_score") or similarity),
            age_hours=float(row.get("age_hours") or 0.0),
            source="vector",
        )

    async def keyword_search(
        self, *, user_id: str, keywords: list[str], count: int, max_age_days: int
    ) -> list[RetrievedMemory]:
        """FTS fallback using PostgREST `or_(ilike)`.

        Always scoped by `user_id` — the fallback must not be a looser isolation
        boundary than the vector path.
        """
        if not keywords:
            return []
        client = self._client()
        or_clause = ",".join(f"turn_text.ilike.%{kw}%" for kw in keywords)
        res = await self._bounded(
            client.table(self._table)
            .select("turn_text, metadata, created_at")
            .eq("user_id", user_id)
            .or_(or_clause)
            .order("created_at", desc=True)
            .limit(max(count * 2, count))
            .execute(),
            LIMITS.fts_read_timeout_s,
        )
        rows = getattr(res, "data", None) or []
        out: list[RetrievedMemory] = []
        now = time.time()
        for row in rows:
            age_hours = _age_hours(row.get("created_at"), now)
            if age_hours is not None and age_hours > max_age_days * 24:
                continue
            text = row.get("turn_text") or ""
            low = text.lower()
            hits = sum(1 for kw in keywords if kw in low)
            keyword_score = hits / len(keywords) if keywords else 0.0
            age = age_hours or 0.0
            recency = max(0.0, 1.0 - (age / (max_age_days * 24)))
            meta = row.get("metadata") or {}
            out.append(
                RetrievedMemory(
                    text=text,
                    similarity=round(keyword_score, 3),
                    tier=_coerce_tier(meta.get("tier") if isinstance(meta, dict) else None),
                    metadata=meta if isinstance(meta, dict) else {},
                    recency_score=round(recency, 3),
                    final_score=round(keyword_score * 0.7 + recency * 0.3, 3),
                    age_hours=round(age, 1),
                    source="fts",
                )
            )
        out.sort(key=lambda m: m.final_score, reverse=True)
        return out[:count]

    # ── schema probes (used by diagnostics) ──────────────────────────
    async def probe_table(self) -> tuple[bool, str]:
        try:
            client = self._client()
            await self._bounded(
                client.table(self._table).select("embedding_id").limit(1).execute(),
                LIMITS.schema_probe_timeout_s,
            )
            return True, ""
        except StoreError as e:
            return False, e.detail

    async def probe_rpc(self, rpc: str) -> tuple[bool, str]:
        """Call the RPC with a zero vector and an impossible threshold.

        Returns rows=0 when present, RPC_MISSING when not. Read-only: it can
        never match a real memory.
        """
        from backend.memory.core.contracts import VECTOR_DIM

        try:
            client = self._client()
            args = self._rpc_args(rpc, "__schema_probe__", [0.0] * VECTOR_DIM, 1, 0.999999)
            await self._bounded(client.rpc(rpc, args).execute(), LIMITS.schema_probe_timeout_s)
            self._rpc_cache[rpc] = True
            return True, ""
        except StoreError as e:
            if e.outcome is MemoryOutcome.RPC_MISSING:
                self._rpc_cache[rpc] = False
            return False, e.detail


def _coerce_tier(value: Any) -> MemoryTier:
    try:
        return MemoryTier(str(value))
    except (ValueError, TypeError):
        return MemoryTier.DEEP


def _age_hours(created_at: Any, now: float) -> Optional[float]:
    if not created_at:
        return None
    try:
        from datetime import datetime

        dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        return max(0.0, (now - dt.timestamp()) / 3600.0)
    except (ValueError, TypeError, OSError):
        # Unparseable timestamp: treated as unknown age rather than "brand new",
        # so a corrupt value cannot win the recency ranking.
        return None
