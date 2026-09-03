"""Memory contracts — models, explicit result states, and resource bounds.

This module is the vocabulary of the memory subsystem. It has NO dependencies
on Supabase, Redis, embedding providers, FastAPI, or any frontend concept, so
every other memory module can import it without creating a cycle.

DESIGN RULE — no ambiguous emptiness
────────────────────────────────────
The defect this replaces: every failure in the old memory path returned `[]`.
An unapplied migration, an expired API key, a network timeout and "this user
genuinely has no memories" were the same value, so the system reported healthy
while storing and retrieving nothing. Callers here always receive an explicit
`MemoryOutcome` alongside the records.
"""

from __future__ import annotations

import hashlib
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


# ── Authoritative store declaration ──────────────────────────────────
# Recorded in code, not only in documentation, so a future reader cannot
# mistake a cache for the source of truth.

AUTHORITATIVE_STORE = "supabase_postgres_pgvector"
AUTHORITATIVE_TABLE = "aura_chroma_backup"
IDENTITY_TABLE = "aura_storage"

#: Every non-authoritative dependency, with its role. Anything absent from
#: this map has no sanctioned role in the memory path.
INFRASTRUCTURE_ROLES: dict[str, str] = {
    "supabase_postgres": "AUTHORITATIVE",
    "pgvector": "INDEX",  # index over the authoritative rows, not a store
    "postgres_fts": "FALLBACK",  # keyword retrieval when vectors unavailable
    "redis": "CACHE",  # embedding cache, rate limits, proactive keys
    "valkey": "DEAD",  # named in UI/docs only; no client, no code path
    "pinecone": "DEAD",  # key accepted and echoed; no vector ever stored
    "chromadb": "LEGACY",  # naming fossil; pgvector is the real backend
    "browser_localstorage": "FALLBACK",  # offline-only; never authoritative
}


# ── Vector contract ──────────────────────────────────────────────────
#: Must equal the pgvector column width. Verified at runtime by
#: `diagnostics.verify_schema_contract`, not assumed from migration files.
VECTOR_DIM = 768


# ── Resource bounds ──────────────────────────────────────────────────
@dataclass(frozen=True)
class MemoryLimits:
    """Hard bounds. A malformed or enormous request must not destabilize
    the process, so every one of these is enforced, not advisory."""

    max_text_chars: int = 4000
    max_metadata_bytes: int = 4096
    max_records_per_write: int = 32
    max_retrieval_count: int = 20
    max_context_chars: int = 1600  # matches the frontend prompt budget
    max_embedding_batch: int = 8
    max_retries: int = 2  # total attempts = 1 + max_retries
    retry_base_delay_s: float = 0.15

    # Bounded time for every external dependency. No unbounded await.
    embed_timeout_s: float = 6.0
    write_timeout_s: float = 5.0
    vector_read_timeout_s: float = 2.5
    fts_read_timeout_s: float = 2.5
    schema_probe_timeout_s: float = 4.0


LIMITS = MemoryLimits()


# ── Tiers ────────────────────────────────────────────────────────────
class MemoryTier(str, Enum):
    """The four-layer model.

    LIVE     — current session state; in-process cache + `aura_storage` user model.
    SEED     — compressed session summary carried into the next session.
    DEEP     — durable per-turn episodic rows in the authoritative table.
    DURABLE  — consolidated long-horizon episodes (written by consolidation).
    """

    LIVE = "live"
    SEED = "seed"
    DEEP = "deep"
    DURABLE = "durable"


# ── Outcomes ─────────────────────────────────────────────────────────
class MemoryOutcome(str, Enum):
    """Why an operation ended the way it did.

    Success states and failure states are deliberately separate values so
    telemetry and callers can never conflate "nothing matched" with
    "infrastructure is broken".
    """

    SUCCESS_WITH_RESULTS = "success_with_results"
    SUCCESS_NO_RESULTS = "success_no_results"
    WRITTEN = "written"
    DUPLICATE_IGNORED = "duplicate_ignored"

    # Degraded-but-served
    FTS_FALLBACK = "fts_fallback"

    # Failures — each distinguishable
    VECTOR_UNAVAILABLE = "vector_unavailable"
    RPC_MISSING = "rpc_missing"
    EMBEDDING_FAILED = "embedding_failed"
    EMBEDDING_DIM_MISMATCH = "embedding_dim_mismatch"
    DATABASE_UNAVAILABLE = "database_unavailable"
    TIMEOUT = "timeout"
    INVALID_QUERY = "invalid_query"
    INVALID_RECORD = "invalid_record"
    LIMIT_EXCEEDED = "limit_exceeded"
    CIRCUIT_OPEN = "circuit_open"

    @property
    def ok(self) -> bool:
        return self in _OK_OUTCOMES

    @property
    def degraded(self) -> bool:
        return self is MemoryOutcome.FTS_FALLBACK

    @property
    def failed(self) -> bool:
        return not self.ok


_OK_OUTCOMES = frozenset(
    {
        MemoryOutcome.SUCCESS_WITH_RESULTS,
        MemoryOutcome.SUCCESS_NO_RESULTS,
        MemoryOutcome.WRITTEN,
        MemoryOutcome.DUPLICATE_IGNORED,
        MemoryOutcome.FTS_FALLBACK,
    }
)

#: Failures worth retrying. Everything else is permanent for this request —
#: retrying a missing RPC or a malformed record can never succeed.
TRANSIENT_OUTCOMES = frozenset(
    {
        MemoryOutcome.TIMEOUT,
        MemoryOutcome.DATABASE_UNAVAILABLE,
    }
)


# ── Records ──────────────────────────────────────────────────────────
def normalize_text(text: str) -> str:
    """Canonical form used for dedup and cache keys. Collapses whitespace
    and case so trivially-different retries hash identically."""
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def content_hash(user_id: str, text: str) -> str:
    """Stable idempotency key for a (user, utterance) pair.

    Deliberately excludes session_id and timestamp: the same sentence from the
    same user is the same memory whether it arrives from a retry, a reconnect,
    a second device, or a duplicated request.
    """
    return hashlib.sha256(
        f"{user_id}\x00{normalize_text(text)}".encode("utf-8")
    ).hexdigest()[:32]


@dataclass
class MemoryRecord:
    """One durable memory. `embedding_id` is the idempotency key."""

    user_id: str
    session_id: str
    text: str
    tier: MemoryTier = MemoryTier.DEEP
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: Optional[list[float]] = None
    embedding_id: str = ""
    created_at: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.embedding_id:
            self.embedding_id = content_hash(self.user_id, self.text)

    def to_row(self) -> dict[str, Any]:
        """Map onto the live `aura_chroma_backup` columns.

        Column names are fixed by the deployed schema, verified by
        `diagnostics.verify_schema_contract`. `user_id` is a real column AND
        is mirrored into metadata because the 004 RPC overload filters on
        `metadata->>'user_id'` while the 002 overload filters the column.
        """
        meta = dict(self.metadata)
        meta.setdefault("user_id", self.user_id)
        meta.setdefault("tier", self.tier.value)
        meta.setdefault("content_hash", self.embedding_id)
        row: dict[str, Any] = {
            "user_id": self.user_id,
            "session_id": self.session_id,
            "turn_text": self.text,
            "metadata": meta,
            "embedding_id": self.embedding_id,
        }
        if self.created_at:
            row["created_at"] = self.created_at
        if self.embedding is not None:
            row["embedding"] = list(self.embedding)
        return row


@dataclass
class RetrievedMemory:
    """One retrieval hit, normalized across every retrieval mechanism so the
    caller never needs to know which one succeeded."""

    text: str
    similarity: float
    tier: MemoryTier = MemoryTier.DEEP
    metadata: dict[str, Any] = field(default_factory=dict)
    recency_score: float = 0.0
    final_score: float = 0.0
    age_hours: float = 0.0
    source: str = "vector"  # "vector" | "fts" | "identity" | "local"

    @property
    def dedup_key(self) -> str:
        return normalize_text(self.text)

    def to_public(self) -> dict[str, Any]:
        """Shape consumed by the frontend gateway. Backwards-compatible with
        the pre-hardening `results` entries."""
        meta = dict(self.metadata)
        meta.setdefault("tier", self.tier.value)
        meta.setdefault("source", self.source)
        return {
            "content": self.text,
            "metadata": meta,
            "similarity": round(self.similarity, 4),
            "emotional_match": round(float(meta.get("emotional_match", 1.0)), 4),
        }


# ── Operation results ────────────────────────────────────────────────
@dataclass
class WriteResult:
    outcome: MemoryOutcome
    written: int = 0
    duplicates: int = 0
    correlation_id: str = ""
    detail: str = ""
    duration_ms: float = 0.0
    attempts: int = 1
    embedding_provider: str = "none"

    @property
    def ok(self) -> bool:
        return self.outcome.ok


@dataclass
class ReadResult:
    outcome: MemoryOutcome
    memories: list[RetrievedMemory] = field(default_factory=list)
    correlation_id: str = ""
    detail: str = ""
    duration_ms: float = 0.0
    attempts: int = 1
    mechanism: str = "none"  # which retriever actually served the result
    embedding_provider: str = "none"
    budget_chars: int = 0
    dropped_duplicates: int = 0
    dropped_by_budget: int = 0

    @property
    def ok(self) -> bool:
        return self.outcome.ok

    @property
    def served_from_fallback(self) -> bool:
        return self.mechanism == "fts"


def new_correlation_id() -> str:
    """Short id threaded through every stage of one memory operation, so a
    future engineer can grep one token to answer "why didn't AURA remember?"."""
    return uuid.uuid4().hex[:12]


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def monotonic_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 2)
