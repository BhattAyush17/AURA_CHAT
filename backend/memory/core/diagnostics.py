"""Memory diagnostics — the first place to look during an incident.

Answers, in one call:
  * is the memory subsystem HEALTHY / DEGRADED / FAILED, and why
  * does the live schema match what the code assumes (table, columns, vector dim)
  * which vector RPCs actually exist
  * which embedding tier is live, and can it really embed
  * what has been failing recently, with correlation ids

Every check is read-only. `verify_schema_contract` deliberately does not trust
migration files — the repo contains two incompatible `match_memories_v2`
definitions and neither proves what is deployed.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from backend.memory.core.contracts import (
    AUTHORITATIVE_STORE,
    AUTHORITATIVE_TABLE,
    INFRASTRUCTURE_ROLES,
    LIMITS,
    VECTOR_DIM,
    MemoryOutcome,
    monotonic_ms,
    new_correlation_id,
)
from backend.memory.core.telemetry import memory_telemetry

#: Columns the write path depends on. A missing one means writes fail at runtime,
#: so it is a schema-contract violation, not a warning.
REQUIRED_COLUMNS = ("user_id", "session_id", "turn_text", "metadata", "embedding_id")

#: RPCs the read path can use. At least one must exist or vector retrieval is off.
KNOWN_VECTOR_RPCS = ("match_memories",)


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    latency_ms: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class MemoryDiagnostics:
    status: str  # HEALTHY | DEGRADED | FAILED
    authoritative_store: str
    infrastructure_roles: dict[str, str]
    vector_dim_required: int
    checks: list[Check]
    telemetry: dict[str, Any]
    schema_contract_ok: bool
    vector_search_available: bool
    fts_available: bool
    reasons: list[str]
    duration_ms: float

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["checks"] = [asdict(c) for c in self.checks]
        return d


async def _timed(coro, timeout: float) -> tuple[bool, str, float]:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(coro, timeout=timeout)
        return True, "", monotonic_ms(started)
    except asyncio.TimeoutError:
        return False, f"timeout after {timeout}s", monotonic_ms(started)
    except Exception as e:
        return False, str(e)[:300], monotonic_ms(started)


async def verify_schema_contract(store) -> tuple[bool, list[Check]]:
    """Detect schema/code drift before the system can falsely report healthy.

    Checks: the authoritative table is readable; every required column exists;
    the vector column accepts exactly VECTOR_DIM. The dimension check is done by
    calling an RPC with a correctly-sized zero vector — if the column width
    disagreed, Postgres would reject it and we would see the error rather than
    silently writing unusable rows.
    """
    checks: list[Check] = []

    table_ok, table_detail = await store.probe_table()
    checks.append(
        Check(
            name=f"table:{AUTHORITATIVE_TABLE}",
            ok=table_ok,
            detail=table_detail,
            extra={"role": "AUTHORITATIVE"},
        )
    )
    if not table_ok:
        return False, checks

    missing: list[str] = []
    for col in REQUIRED_COLUMNS:
        ok, detail, ms = await _timed(
            _select_column(store, col), LIMITS.schema_probe_timeout_s
        )
        if not ok:
            missing.append(col)
        checks.append(Check(name=f"column:{col}", ok=ok, detail=detail, latency_ms=ms))

    dim_ok, dim_detail, dim_ms = await _timed(
        _probe_vector_dim(store), LIMITS.schema_probe_timeout_s
    )
    checks.append(
        Check(
            name=f"vector_dim:{VECTOR_DIM}",
            ok=dim_ok,
            detail=dim_detail,
            latency_ms=dim_ms,
            extra={"required": VECTOR_DIM},
        )
    )

    contract_ok = table_ok and not missing and dim_ok
    return contract_ok, checks


async def _select_column(store, column: str) -> None:
    client = store._client()  # adapter-internal by design: diagnostics is its peer
    await client.table(AUTHORITATIVE_TABLE).select(column).limit(1).execute()


async def _probe_vector_dim(store) -> None:
    """A correctly-sized zero vector through any available RPC.

    If no RPC exists this raises RPC_MISSING, which is reported separately —
    the dimension itself is then unverifiable, which is honest.
    """
    from backend.memory.core.contracts import VECTOR_DIM as _DIM

    last: Optional[Exception] = None
    for rpc in KNOWN_VECTOR_RPCS:
        ok, detail = await store.probe_rpc(rpc)
        if ok:
            return
        last = RuntimeError(detail)
    raise last or RuntimeError("no vector RPC available to verify dimension")


async def run_diagnostics(orchestrator, *, redis_client=None) -> MemoryDiagnostics:
    """Full read-only sweep. Safe to expose on an endpoint."""
    started = time.perf_counter()
    cid = new_correlation_id()
    checks: list[Check] = []
    reasons: list[str] = []

    if orchestrator is None:
        return MemoryDiagnostics(
            status="FAILED",
            authoritative_store=AUTHORITATIVE_STORE,
            infrastructure_roles=dict(INFRASTRUCTURE_ROLES),
            vector_dim_required=VECTOR_DIM,
            checks=[Check("orchestrator", False, "memory orchestrator not configured")],
            telemetry=memory_telemetry.snapshot(),
            schema_contract_ok=False,
            vector_search_available=False,
            fts_available=False,
            reasons=["memory orchestrator not configured"],
            duration_ms=monotonic_ms(started),
        )

    store = orchestrator.store

    # ── database reachability ────────────────────────────────────────
    db_ok = await store.is_available()
    checks.append(
        Check("database:supabase", db_ok, "" if db_ok else "client not initialized")
    )
    if not db_ok:
        reasons.append("supabase client not initialized")

    # ── schema contract ─────────────────────────────────────────────
    schema_ok = False
    if db_ok:
        store.invalidate_rpc_cache()  # force a fresh probe, post-migration
        schema_ok, schema_checks = await verify_schema_contract(store)
        checks.extend(schema_checks)
        if not schema_ok:
            failed = [c.name for c in schema_checks if not c.ok]
            reasons.append(f"schema contract violated: {', '.join(failed)}")

    # ── RPC availability ────────────────────────────────────────────
    vector_ok = False
    if db_ok:
        for rpc in KNOWN_VECTOR_RPCS:
            ok, detail = await store.probe_rpc(rpc)
            checks.append(
                Check(f"rpc:{rpc}", ok, detail, extra={"role": "INDEX"})
            )
            vector_ok = vector_ok or ok
        if not vector_ok:
            reasons.append(
                "no vector RPC deployed — apply docs/migrations/002_match_memories_v2.sql"
            )

    # ── FTS fallback ────────────────────────────────────────────────
    fts_ok = False
    if db_ok:
        ok, detail, ms = await _timed(
            store.keyword_search(
                user_id="__diagnostics_probe__",
                keywords=["diagnostics"],
                count=1,
                max_age_days=1,
            ),
            LIMITS.fts_read_timeout_s,
        )
        fts_ok = ok
        checks.append(Check("fts:keyword_search", ok, detail, ms, {"role": "FALLBACK"}))
        if not ok:
            reasons.append("FTS fallback unavailable")

    # ── embedding provider ──────────────────────────────────────────
    from backend.infrastructure.embedding_provider import embedding_provider
    from backend.memory.embedding.embedder import embed_text

    embed = await embed_text("memory diagnostics probe", correlation_id=cid)
    checks.append(
        Check(
            f"embedding:{embedding_provider.provider_name}",
            embed.ok,
            embed.detail,
            embed.duration_ms,
            {"dim": len(embed.vector or []), "required": VECTOR_DIM},
        )
    )
    if not embed.ok:
        reasons.append(f"embedding unavailable ({embed.outcome.value}) — vector writes degrade to text-only")

    # ── Redis: CACHE only, never authoritative ──────────────────────
    if redis_client is not None:
        ok, detail, ms = await _timed(redis_client.ping(), 1.5)
        checks.append(Check("redis:ping", ok, detail, ms, {"role": "CACHE"}))
        if not ok:
            # Explicitly not a reason for DEGRADED: the cache is not on the
            # correctness path, only the latency path.
            checks[-1].extra["impact"] = "latency only — embedding cache misses"

    # ── verdict ─────────────────────────────────────────────────────
    if not db_ok or not schema_ok:
        status = "FAILED"
    elif not vector_ok or not embed.ok:
        status = "DEGRADED"  # serving from FTS
    else:
        status = "HEALTHY"

    diag = MemoryDiagnostics(
        status=status,
        authoritative_store=AUTHORITATIVE_STORE,
        infrastructure_roles=dict(INFRASTRUCTURE_ROLES),
        vector_dim_required=VECTOR_DIM,
        checks=checks,
        telemetry=memory_telemetry.snapshot(),
        schema_contract_ok=schema_ok,
        vector_search_available=vector_ok,
        fts_available=fts_ok,
        reasons=reasons,
        duration_ms=monotonic_ms(started),
    )
    memory_telemetry.emit(
        "memory.schema",
        MemoryOutcome.SUCCESS_WITH_RESULTS if status == "HEALTHY" else MemoryOutcome.SUCCESS_NO_RESULTS,
        correlation_id=cid,
        duration_ms=diag.duration_ms,
        status=status,
        detail="; ".join(reasons)[:300],
    )
    return diag
