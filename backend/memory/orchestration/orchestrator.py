"""MemoryOrchestrator — the single entry point for memory operations.

Everything above this line (endpoints, the cognitive pipeline, providers) talks
to this class. Everything below it (embedding, storage, retrieval, ranking) is
an implementation detail.

Responsibilities kept here and nowhere else:
  * bounded retries with backoff, only for transient outcomes
  * circuit breaking / degradation
  * correlation ids
  * turning stage results into one explicit `WriteResult` / `ReadResult`
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from backend.memory.core.contracts import (
    LIMITS,
    TRANSIENT_OUTCOMES,
    MemoryOutcome,
    MemoryRecord,
    MemoryTier,
    ReadResult,
    RetrievedMemory,
    WriteResult,
    monotonic_ms,
    new_correlation_id,
)
from backend.memory.core.telemetry import memory_telemetry
from backend.memory.core.validation import ValidationError, validate_batch, validate_count, validate_query, validate_user_id
from backend.memory.embedding.embedder import embed_text
from backend.memory.ranking.ranker import format_context_block, rank_and_budget
from backend.memory.retrieval.retriever import MemoryRetriever
from backend.memory.storage.supabase_store import StoreError, SupabaseMemoryStore


class MemoryOrchestrator:
    """Write / read / sync with retry and fallback.

    Construction takes a *client provider callable*, not a client. The Supabase
    client is created in FastAPI's startup event, long after import time, and is
    replaced on BYOK reconfiguration — so resolving it late is what makes this
    restart- and reconnect-safe.
    """

    def __init__(self, client_provider, *, cache=None, degradation=None) -> None:
        self.store = SupabaseMemoryStore(client_provider)
        self.retriever = MemoryRetriever(self.store, cache=cache)
        self._cache = cache
        self._degradation = degradation

    # ── circuit helpers ──────────────────────────────────────────────
    def _circuit_open(self) -> bool:
        if self._degradation is None:
            return False
        circuit = getattr(self._degradation, "circuits", {}).get("supabase")
        if circuit is None:
            return False
        return not circuit.should_allow_request

    def _record(self, ok: bool) -> None:
        if self._degradation is None:
            return
        circuit = getattr(self._degradation, "circuits", {}).get("supabase")
        if circuit is None:
            return
        circuit.record_success() if ok else circuit.record_failure()

    # ── WRITE ────────────────────────────────────────────────────────
    async def write(
        self,
        *,
        user_id: str,
        session_id: str,
        text: str,
        tier: MemoryTier = MemoryTier.DEEP,
        metadata: Optional[dict[str, Any]] = None,
        correlation_id: str = "",
    ) -> WriteResult:
        """Persist one memory to the authoritative store.

        Never reports success unless a row was written or a genuine duplicate
        was detected. This is the inverse of the old client-side behaviour,
        which returned `true` in supabase mode without writing anything.
        """
        cid = correlation_id or new_correlation_id()
        started = time.perf_counter()

        try:
            records = validate_batch(
                [
                    MemoryRecord(
                        user_id=user_id,
                        session_id=session_id,
                        text=text,
                        tier=tier,
                        metadata=dict(metadata or {}),
                    )
                ]
            )
        except ValidationError as e:
            memory_telemetry.emit(
                "memory.write", e.outcome, correlation_id=cid, detail=e.detail
            )
            return WriteResult(e.outcome, correlation_id=cid, detail=e.detail)

        if self._circuit_open():
            memory_telemetry.emit(
                "memory.write",
                MemoryOutcome.CIRCUIT_OPEN,
                correlation_id=cid,
                detail="supabase circuit open",
            )
            return WriteResult(
                MemoryOutcome.CIRCUIT_OPEN, correlation_id=cid, detail="supabase circuit open"
            )

        # Embedding is best-effort: a text-only row is still retrievable through
        # the keyword fallback, and losing the memory entirely would be worse.
        embed = await embed_text(records[0].text, correlation_id=cid, cache=self._cache)
        if embed.ok:
            records[0].embedding = embed.vector
        provider = embed.provider

        result = await self._with_retry(
            lambda: self.store.upsert(records), stage="memory.write", cid=cid
        )
        if isinstance(result, StoreError):
            self._record(False)
            memory_telemetry.emit(
                "memory.write",
                result.outcome,
                correlation_id=cid,
                duration_ms=monotonic_ms(started),
                detail=result.detail,
                provider=provider,
            )
            return WriteResult(
                result.outcome,
                correlation_id=cid,
                detail=result.detail,
                duration_ms=monotonic_ms(started),
                embedding_provider=provider,
            )

        written, duplicates = result
        self._record(True)
        outcome = MemoryOutcome.WRITTEN if written else MemoryOutcome.DUPLICATE_IGNORED
        duration = monotonic_ms(started)
        memory_telemetry.emit(
            "memory.write",
            outcome,
            correlation_id=cid,
            duration_ms=duration,
            written=written,
            duplicates=duplicates,
            provider=provider,
            tier=tier.value,
            embedded=embed.ok,
            text_len=len(records[0].text),
        )
        return WriteResult(
            outcome,
            written=written,
            duplicates=duplicates,
            correlation_id=cid,
            duration_ms=duration,
            embedding_provider=provider,
        )

    # ── READ ─────────────────────────────────────────────────────────
    async def read(
        self,
        *,
        user_id: str,
        query: str,
        count: int = 5,
        threshold: float = 0.35,
        correlation_id: str = "",
        max_chars: int = LIMITS.max_context_chars,
    ) -> ReadResult:
        """Retrieve, rank, dedup and budget in one call.

        The returned `outcome` distinguishes "this user has no memories" from
        every infrastructure failure mode.
        """
        cid = correlation_id or new_correlation_id()
        started = time.perf_counter()

        try:
            uid = validate_user_id(user_id)
            q = validate_query(query)
            n = validate_count(count)
        except ValidationError as e:
            memory_telemetry.emit(
                "memory.read", e.outcome, correlation_id=cid, detail=e.detail
            )
            return ReadResult(e.outcome, correlation_id=cid, detail=e.detail)

        if self._circuit_open():
            memory_telemetry.emit(
                "memory.read",
                MemoryOutcome.CIRCUIT_OPEN,
                correlation_id=cid,
                detail="supabase circuit open",
            )
            return ReadResult(
                MemoryOutcome.CIRCUIT_OPEN, correlation_id=cid, detail="supabase circuit open"
            )

        retrieval = await self.retriever.retrieve(
            user_id=uid, query=q, count=n, threshold=threshold, correlation_id=cid
        )
        self._record(not retrieval.outcome.failed)

        ranked = rank_and_budget(retrieval.memories, max_chars=max_chars, max_count=n)
        memory_telemetry.emit(
            "memory.rank",
            MemoryOutcome.SUCCESS_WITH_RESULTS if ranked.memories else MemoryOutcome.SUCCESS_NO_RESULTS,
            correlation_id=cid,
            kept=len(ranked.memories),
            dropped_duplicates=ranked.dropped_duplicates,
            dropped_by_budget=ranked.dropped_by_budget,
            chars=ranked.total_chars,
        )

        duration = monotonic_ms(started)
        outcome = retrieval.outcome
        # A successful retrieval that ranked to nothing is "no results", not a
        # failure — but a degraded (FTS) success stays flagged as degraded.
        if outcome is MemoryOutcome.SUCCESS_WITH_RESULTS and not ranked.memories:
            outcome = MemoryOutcome.SUCCESS_NO_RESULTS

        memory_telemetry.emit(
            "memory.read",
            outcome,
            correlation_id=cid,
            duration_ms=duration,
            mechanism=retrieval.mechanism,
            count=len(ranked.memories),
            provider=retrieval.embedding_provider,
            detail=retrieval.detail,
        )
        return ReadResult(
            outcome,
            memories=ranked.memories,
            correlation_id=cid,
            detail=retrieval.detail,
            duration_ms=duration,
            mechanism=retrieval.mechanism,
            embedding_provider=retrieval.embedding_provider,
            budget_chars=ranked.total_chars,
            dropped_duplicates=ranked.dropped_duplicates,
            dropped_by_budget=ranked.dropped_by_budget,
        )

    async def read_context_block(
        self, *, user_id: str, query: str, count: int = 5, correlation_id: str = ""
    ) -> tuple[str, ReadResult]:
        """Convenience for the cognitive layer: the bounded prompt block plus
        the full result, so a caller can log *why* the block is empty."""
        result = await self.read(
            user_id=user_id, query=query, count=count, correlation_id=correlation_id
        )
        block = format_context_block(result.memories)
        memory_telemetry.emit(
            "memory.context",
            result.outcome,
            correlation_id=result.correlation_id,
            chars=len(block),
            count=len(result.memories),
            mechanism=result.mechanism,
        )
        return block, result

    # ── retry ────────────────────────────────────────────────────────
    async def _with_retry(self, op, *, stage: str, cid: str):
        """Bounded, backoff-aware, transient-only retry.

        Permanent outcomes (missing RPC, invalid record, dimension mismatch) are
        returned on the first failure: retrying them can never succeed and only
        adds latency to the voice loop.
        """
        attempt = 0
        last: Optional[StoreError] = None
        while attempt <= LIMITS.max_retries:
            try:
                return await op()
            except Exception as e:
                if isinstance(e, StoreError):
                    last = e
                else:
                    last = StoreError(MemoryOutcome.DATABASE_UNAVAILABLE, str(e))
                
                if last.outcome not in TRANSIENT_OUTCOMES:
                    return last
                    
                attempt += 1
                if attempt > LIMITS.max_retries:
                    break
                    
                delay = LIMITS.retry_base_delay_s * (2 ** (attempt - 1))
                memory_telemetry.emit(
                    f"{stage}.retry",
                    last.outcome,
                    correlation_id=cid,
                    detail=last.detail,
                    attempt=attempt,
                    delay_s=round(delay, 3),
                )
                await asyncio.sleep(delay)
        return last or StoreError(MemoryOutcome.DATABASE_UNAVAILABLE, "unknown failure")


# ── Module singleton ─────────────────────────────────────────────────
_orchestrator: Optional[MemoryOrchestrator] = None


def configure_orchestrator(client_provider, *, cache=None, degradation=None) -> MemoryOrchestrator:
    global _orchestrator
    _orchestrator = MemoryOrchestrator(
        client_provider, cache=cache, degradation=degradation
    )
    return _orchestrator


def get_orchestrator() -> Optional[MemoryOrchestrator]:
    return _orchestrator
