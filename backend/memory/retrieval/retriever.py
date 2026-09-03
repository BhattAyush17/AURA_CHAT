"""Retrieval chain — Vector → FTS → safe empty, with the mechanism reported.

The caller does not need to know which mechanism succeeded, but it is always
told, because "served from the keyword fallback" and "served from pgvector" are
operationally different even though both are successes.

This module never opens a database connection itself; it drives a `MemoryStore`.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Optional

from backend.memory.core.contracts import (
    LIMITS,
    MemoryOutcome,
    RetrievedMemory,
    monotonic_ms,
)
from backend.memory.core.telemetry import memory_telemetry
from backend.memory.embedding.embedder import embed_text
from backend.memory.storage.supabase_store import StoreError

# Stop words for keyword extraction. Hinglish is first-class in AURA, so Hindi
# function words are included — otherwise "mujhe yaad hai" degrades to noise.
_STOP_WORDS = frozenset(
    """
    a an the and or but if then than that this these those is am are was were be been being
    do does did doing have has had having i me my we our you your he him his she her it its
    they them their what which who whom when where why how all any both each few more most
    other some such no nor not only own same so too very can will just should now to of in
    on at by for with about against between into through during before after above below
    from up down out off over under again further once here there
    hai hain tha the thi ho hoon hu hun kya kaise kyun kyu main mai mera meri mere tum tera
    teri tere aap apka apki hum hamara humara wo woh yeh ye us is ka ki ke ko se par bhi
    nahi na haan ji bas abhi phir aur ya lekin magar toh to kuch sab bahut thoda
    mujhe mujhko tujhe tumhe hume unko usko inko chahiye chaahiye karo kar kiya karna
    raha rahi rahe gaya gayi gaye liya diya please thanks thank okay sorry yaar acha achha
    """.split()
)


def extract_keywords(text: str, max_keywords: int = 8) -> list[str]:
    """Lowercased, deduplicated, stop-worded tokens for the FTS fallback."""
    tokens = re.findall(r"[\w']+", (text or "").lower())
    out: list[str] = []
    seen: set[str] = set()
    for t in tokens:
        if len(t) < 3 or t in _STOP_WORDS or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= max_keywords:
            break
    return out


@dataclass
class RetrievalAttempt:
    mechanism: str
    outcome: MemoryOutcome
    detail: str = ""
    duration_ms: float = 0.0
    count: int = 0


@dataclass
class RetrievalResult:
    outcome: MemoryOutcome
    memories: list[RetrievedMemory]
    mechanism: str
    attempts: list[RetrievalAttempt]
    embedding_provider: str = "none"
    detail: str = ""


class MemoryRetriever:
    """Vector-first retrieval with a keyword fallback.

    Degradation ladder, in order:
      1. vector search (pgvector RPC)
      2. keyword search (FTS-style ILIKE) — when embeddings or the RPC are gone
      3. safe empty result, with the reason preserved

    Step 2 is attempted whenever step 1 could not run OR returned nothing while
    the store is reachable: a user with memories should not be told "nothing"
    merely because the vector leg is unavailable.
    """

    def __init__(self, store, *, cache=None) -> None:
        self._store = store
        self._cache = cache

    async def retrieve(
        self,
        *,
        user_id: str,
        query: str,
        count: int = 5,
        threshold: float = 0.35,
        max_age_days: int = 365,
        correlation_id: str = "",
    ) -> RetrievalResult:
        attempts: list[RetrievalAttempt] = []

        embed = await embed_text(query, correlation_id=correlation_id, cache=self._cache)
        provider = embed.provider

        # ── 1. Vector ────────────────────────────────────────────────
        vector_blocked: Optional[MemoryOutcome] = None
        if embed.ok:
            started = time.perf_counter()
            try:
                hits = await self._store.vector_search(
                    user_id=user_id,
                    embedding=embed.vector or [],
                    count=count,
                    threshold=threshold,
                )
                dur = monotonic_ms(started)
                attempts.append(
                    RetrievalAttempt("vector", MemoryOutcome.SUCCESS_WITH_RESULTS, "", dur, len(hits))
                )
                memory_telemetry.emit(
                    "memory.vector",
                    MemoryOutcome.SUCCESS_WITH_RESULTS if hits else MemoryOutcome.SUCCESS_NO_RESULTS,
                    correlation_id=correlation_id,
                    duration_ms=dur,
                    count=len(hits),
                    provider=provider,
                )
                if hits:
                    return RetrievalResult(
                        MemoryOutcome.SUCCESS_WITH_RESULTS, hits, "vector", attempts, provider
                    )
                # Zero vector hits above threshold — fall through to keywords
                # before concluding the user has no memories.
            except StoreError as e:
                dur = monotonic_ms(started)
                vector_blocked = e.outcome
                attempts.append(RetrievalAttempt("vector", e.outcome, e.detail, dur))
                memory_telemetry.emit(
                    "memory.vector",
                    e.outcome,
                    correlation_id=correlation_id,
                    duration_ms=dur,
                    detail=e.detail,
                    provider=provider,
                    **(
                        {"hint": "apply docs/migrations/002_match_memories_v2.sql"}
                        if e.outcome is MemoryOutcome.RPC_MISSING
                        else {}
                    ),
                )
        else:
            vector_blocked = embed.outcome
            attempts.append(
                RetrievalAttempt("vector", MemoryOutcome.VECTOR_UNAVAILABLE, embed.detail)
            )

        # ── 2. Keyword fallback ──────────────────────────────────────
        keywords = extract_keywords(query)
        if not keywords:
            outcome = vector_blocked or MemoryOutcome.SUCCESS_NO_RESULTS
            return RetrievalResult(
                outcome, [], "none", attempts, provider, "no usable keywords in query"
            )

        started = time.perf_counter()
        try:
            hits = await self._store.keyword_search(
                user_id=user_id, keywords=keywords, count=count, max_age_days=max_age_days
            )
            dur = monotonic_ms(started)
            attempts.append(
                RetrievalAttempt(
                    "fts",
                    MemoryOutcome.SUCCESS_WITH_RESULTS if hits else MemoryOutcome.SUCCESS_NO_RESULTS,
                    "",
                    dur,
                    len(hits),
                )
            )
            memory_telemetry.emit(
                "memory.fts",
                MemoryOutcome.FTS_FALLBACK if hits else MemoryOutcome.SUCCESS_NO_RESULTS,
                correlation_id=correlation_id,
                duration_ms=dur,
                count=len(hits),
                keywords=len(keywords),
                reason=vector_blocked.value if vector_blocked else "vector_zero_hits",
            )
            if hits:
                # Degraded success: results are real, but keyword-ranked.
                return RetrievalResult(
                    MemoryOutcome.FTS_FALLBACK, hits, "fts", attempts, provider
                )
            # Both legs ran and genuinely found nothing. Only now is
            # "no results" the truth — unless the vector leg never ran, in
            # which case the vector failure is the more useful outcome.
            return RetrievalResult(
                vector_blocked or MemoryOutcome.SUCCESS_NO_RESULTS,
                [],
                "fts",
                attempts,
                provider,
            )
        except StoreError as e:
            dur = monotonic_ms(started)
            attempts.append(RetrievalAttempt("fts", e.outcome, e.detail, dur))
            memory_telemetry.emit(
                "memory.fts",
                e.outcome,
                correlation_id=correlation_id,
                duration_ms=dur,
                detail=e.detail,
            )
            # ── 3. Safe empty, reason preserved ──────────────────────
            return RetrievalResult(e.outcome, [], "none", attempts, provider, e.detail)
