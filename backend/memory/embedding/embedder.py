"""Embedding stage — one bounded, validated call, with explicit failure states.

Wraps the existing multi-tier `embedding_provider` (Gemini → Cohere → FastEmbed
→ none) rather than replacing it. Adds: a hard timeout, dimension validation
before the vector can reach a fixed-width column, and an outcome the caller can
branch on.

Nothing here knows about providers, prompts, or storage.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Optional

from backend.infrastructure.embedding_provider import embedding_provider
from backend.memory.core.contracts import (
    LIMITS,
    VECTOR_DIM,
    MemoryOutcome,
    monotonic_ms,
)
from backend.memory.core.telemetry import memory_telemetry
from backend.memory.core.validation import ValidationError, validate_embedding


@dataclass
class EmbedResult:
    outcome: MemoryOutcome
    vector: Optional[list[float]] = None
    provider: str = "none"
    duration_ms: float = 0.0
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.vector is not None and len(self.vector) == VECTOR_DIM


async def embed_text(
    text: str,
    *,
    correlation_id: str = "",
    cache=None,
) -> EmbedResult:
    """Embed one string.

    `cache` is the optional Redis-backed EmbeddingCache. It is a CACHE, never
    authoritative: a cache miss or a cache failure must still produce a live
    embedding, so cache errors fall through to the provider.
    """
    started = time.perf_counter()
    provider = embedding_provider.provider_name

    if not (text or "").strip():
        memory_telemetry.emit(
            "memory.embed",
            MemoryOutcome.INVALID_QUERY,
            correlation_id=correlation_id,
            detail="empty text",
        )
        return EmbedResult(MemoryOutcome.INVALID_QUERY, None, provider, 0.0, "empty text")

    if not embedding_provider.is_available:
        # Not an error: the provider chain deliberately resolves to `none` when
        # no tier can embed, and retrieval then uses FTS.
        memory_telemetry.emit(
            "memory.embed",
            MemoryOutcome.EMBEDDING_FAILED,
            correlation_id=correlation_id,
            duration_ms=monotonic_ms(started),
            detail="no embedding provider available",
            provider="none",
        )
        return EmbedResult(
            MemoryOutcome.EMBEDDING_FAILED,
            None,
            "none",
            monotonic_ms(started),
            "no embedding provider available",
        )

    async def _compute() -> list[float]:
        if cache is not None:
            try:
                return await cache.get_embedding(text)
            except Exception:
                # Cache is best-effort; fall through to the live provider.
                pass
        return await embedding_provider.embed(text)

    try:
        raw = await asyncio.wait_for(_compute(), timeout=LIMITS.embed_timeout_s)
    except asyncio.TimeoutError:
        memory_telemetry.emit(
            "memory.embed",
            MemoryOutcome.TIMEOUT,
            correlation_id=correlation_id,
            duration_ms=monotonic_ms(started),
            provider=provider,
            detail=f"exceeded {LIMITS.embed_timeout_s}s",
        )
        return EmbedResult(
            MemoryOutcome.TIMEOUT, None, provider, monotonic_ms(started), "embed timeout"
        )
    except Exception as e:
        memory_telemetry.emit(
            "memory.embed",
            MemoryOutcome.EMBEDDING_FAILED,
            correlation_id=correlation_id,
            duration_ms=monotonic_ms(started),
            provider=provider,
            detail=str(e)[:200],
        )
        return EmbedResult(
            MemoryOutcome.EMBEDDING_FAILED, None, provider, monotonic_ms(started), str(e)[:200]
        )

    if not raw:
        memory_telemetry.emit(
            "memory.embed",
            MemoryOutcome.EMBEDDING_FAILED,
            correlation_id=correlation_id,
            duration_ms=monotonic_ms(started),
            provider=provider,
            detail="provider returned empty vector",
        )
        return EmbedResult(
            MemoryOutcome.EMBEDDING_FAILED,
            None,
            provider,
            monotonic_ms(started),
            "provider returned empty vector",
        )

    try:
        vector = validate_embedding(list(raw))
    except ValidationError as e:
        # A wrong-width vector is a configuration defect, not a transient error:
        # surfaced explicitly so diagnostics can name it instead of silently
        # writing text-only rows forever.
        memory_telemetry.emit(
            "memory.embed",
            MemoryOutcome.EMBEDDING_DIM_MISMATCH,
            correlation_id=correlation_id,
            duration_ms=monotonic_ms(started),
            provider=provider,
            detail=e.detail,
            got_dim=len(raw),
            want_dim=VECTOR_DIM,
        )
        return EmbedResult(
            MemoryOutcome.EMBEDDING_DIM_MISMATCH,
            None,
            provider,
            monotonic_ms(started),
            e.detail,
        )

    duration = monotonic_ms(started)
    memory_telemetry.emit(
        "memory.embed",
        MemoryOutcome.SUCCESS_WITH_RESULTS,
        correlation_id=correlation_id,
        duration_ms=duration,
        provider=provider,
        dim=len(vector or []),
    )
    return EmbedResult(MemoryOutcome.SUCCESS_WITH_RESULTS, vector, provider, duration)
