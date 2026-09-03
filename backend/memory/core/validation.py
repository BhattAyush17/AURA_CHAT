"""Record validation and bounds enforcement.

Runs before anything touches the network. A malformed or enormous request is
rejected here with an explicit outcome rather than being partially written or
allowed to destabilize the process.
"""

from __future__ import annotations

import json
from typing import Optional

from backend.memory.core.contracts import (
    LIMITS,
    VECTOR_DIM,
    MemoryOutcome,
    MemoryRecord,
    normalize_text,
)


class ValidationError(Exception):
    def __init__(self, outcome: MemoryOutcome, detail: str) -> None:
        super().__init__(detail)
        self.outcome = outcome
        self.detail = detail


def validate_user_id(user_id: str) -> str:
    """User scoping is a correctness boundary, not a convenience.

    An empty or placeholder id would collapse separate users into one bucket,
    so it is rejected outright instead of being written as "anonymous".
    """
    uid = (user_id or "").strip()
    if not uid:
        raise ValidationError(MemoryOutcome.INVALID_RECORD, "user_id is required")
    if uid in {"anonymous", "unknown", "null", "undefined", "local-user"}:
        raise ValidationError(
            MemoryOutcome.INVALID_RECORD, f"placeholder user_id rejected: {uid}"
        )
    if len(uid) > 128:
        raise ValidationError(MemoryOutcome.LIMIT_EXCEEDED, "user_id too long")
    return uid


def validate_query(query: str) -> str:
    q = (query or "").strip()
    if not q:
        raise ValidationError(MemoryOutcome.INVALID_QUERY, "empty query")
    if len(q) > LIMITS.max_text_chars:
        return q[: LIMITS.max_text_chars]
    return q


def validate_count(count: int) -> int:
    if count <= 0:
        raise ValidationError(MemoryOutcome.INVALID_QUERY, "count must be positive")
    return min(count, LIMITS.max_retrieval_count)


def validate_embedding(embedding: Optional[list[float]]) -> Optional[list[float]]:
    """A wrong-width vector must never reach a fixed-width pgvector column.

    Postgres would reject the whole insert, losing the text as well — so a
    dimension mismatch degrades to a text-only row (FTS-retrievable) instead.
    """
    if embedding is None:
        return None
    if not isinstance(embedding, (list, tuple)):
        raise ValidationError(
            MemoryOutcome.EMBEDDING_DIM_MISMATCH, "embedding is not a sequence"
        )
    if len(embedding) == 0:
        return None
    if len(embedding) != VECTOR_DIM:
        raise ValidationError(
            MemoryOutcome.EMBEDDING_DIM_MISMATCH,
            f"embedding dim {len(embedding)} != required {VECTOR_DIM}",
        )
    try:
        return [float(x) for x in embedding]
    except (TypeError, ValueError) as e:
        raise ValidationError(
            MemoryOutcome.EMBEDDING_DIM_MISMATCH, f"non-numeric embedding: {e}"
        ) from e


def validate_record(record: MemoryRecord) -> MemoryRecord:
    """Normalize and bound a single record. Raises ValidationError."""
    record.user_id = validate_user_id(record.user_id)

    text = (record.text or "").strip()
    if not text:
        raise ValidationError(MemoryOutcome.INVALID_RECORD, "empty turn_text")
    if not normalize_text(text):
        raise ValidationError(MemoryOutcome.INVALID_RECORD, "whitespace-only turn_text")
    if len(text) > LIMITS.max_text_chars:
        text = text[: LIMITS.max_text_chars]
    record.text = text

    if not (record.session_id or "").strip():
        raise ValidationError(MemoryOutcome.INVALID_RECORD, "session_id is required")

    if not isinstance(record.metadata, dict):
        raise ValidationError(MemoryOutcome.INVALID_RECORD, "metadata must be a dict")
    try:
        meta_bytes = len(json.dumps(record.metadata, default=str).encode("utf-8"))
    except (TypeError, ValueError) as e:
        raise ValidationError(
            MemoryOutcome.INVALID_RECORD, f"metadata not serializable: {e}"
        ) from e
    if meta_bytes > LIMITS.max_metadata_bytes:
        raise ValidationError(
            MemoryOutcome.LIMIT_EXCEEDED,
            f"metadata {meta_bytes}B exceeds {LIMITS.max_metadata_bytes}B",
        )

    record.embedding = validate_embedding(record.embedding)

    # Recompute the idempotency key after normalization so equivalent texts
    # collapse onto the same key.
    from backend.memory.core.contracts import content_hash

    record.embedding_id = content_hash(record.user_id, record.text)
    return record


def validate_batch(records: list[MemoryRecord]) -> list[MemoryRecord]:
    if len(records) > LIMITS.max_records_per_write:
        raise ValidationError(
            MemoryOutcome.LIMIT_EXCEEDED,
            f"{len(records)} records exceeds {LIMITS.max_records_per_write}",
        )
    return [validate_record(r) for r in records]
