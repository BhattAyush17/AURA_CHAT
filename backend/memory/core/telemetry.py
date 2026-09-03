"""Memory telemetry — one structured event per memory stage.

Every event carries the correlation id, so a single grep answers
"what happened to this memory operation". Memory *contents* are never logged;
only lengths, counts, outcomes and timings.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Optional

from backend.infrastructure.logging import get_logger
from backend.memory.core.contracts import MemoryOutcome

log = get_logger("memory")

#: Canonical stage names. Fixed set so dashboards and greps stay stable.
STAGES = (
    "memory.extract",
    "memory.classify",
    "memory.embed",
    "memory.write",
    "memory.read",
    "memory.vector",
    "memory.fts",
    "memory.rank",
    "memory.dedup",
    "memory.context",
    "memory.sync",
    "memory.schema",
)

_MAX_RECENT_FAILURES = 25


@dataclass
class _Event:
    stage: str
    outcome: str
    correlation_id: str
    duration_ms: float
    at: float = field(default_factory=time.time)
    detail: str = ""
    fields: dict[str, Any] = field(default_factory=dict)


class MemoryTelemetry:
    """In-process rolling counters + recent failures for the diagnostics surface.

    Deliberately not a metrics backend: the goal is that `/api/memory/diagnostics`
    can answer "what has been failing recently" with no external dependency.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._counts: dict[tuple[str, str], int] = {}
        self._latency_sum: dict[str, float] = {}
        self._latency_n: dict[str, int] = {}
        self._recent_failures: deque[_Event] = deque(maxlen=_MAX_RECENT_FAILURES)
        self._last_success_at: dict[str, float] = {}

    def emit(
        self,
        stage: str,
        outcome: MemoryOutcome | str,
        *,
        correlation_id: str = "",
        duration_ms: float = 0.0,
        detail: str = "",
        **fields: Any,
    ) -> None:
        outcome_value = outcome.value if isinstance(outcome, MemoryOutcome) else str(outcome)
        failed = isinstance(outcome, MemoryOutcome) and outcome.failed
        degraded = isinstance(outcome, MemoryOutcome) and outcome.degraded

        ev = _Event(
            stage=stage,
            outcome=outcome_value,
            correlation_id=correlation_id,
            duration_ms=duration_ms,
            detail=detail,
            fields=dict(fields),
        )

        with self._lock:
            key = (stage, outcome_value)
            self._counts[key] = self._counts.get(key, 0) + 1
            self._latency_sum[stage] = self._latency_sum.get(stage, 0.0) + duration_ms
            self._latency_n[stage] = self._latency_n.get(stage, 0) + 1
            if failed:
                self._recent_failures.append(ev)
            else:
                self._last_success_at[stage] = ev.at

        payload = {
            "cid": correlation_id,
            "outcome": outcome_value,
            "duration_ms": duration_ms,
            **({"detail": detail} if detail else {}),
            **fields,
        }
        if failed:
            log.error(stage, **payload)
        elif degraded:
            log.warning(stage, **payload)
        else:
            log.info(stage, **payload)

    # ── Diagnostics surface ──────────────────────────────────────────
    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            by_stage: dict[str, dict[str, Any]] = {}
            for (stage, outcome), n in self._counts.items():
                entry = by_stage.setdefault(stage, {"outcomes": {}, "avg_ms": 0.0, "total": 0})
                entry["outcomes"][outcome] = n
                entry["total"] += n
            for stage, entry in by_stage.items():
                n = self._latency_n.get(stage, 0)
                entry["avg_ms"] = round(self._latency_sum.get(stage, 0.0) / n, 2) if n else 0.0
                last = self._last_success_at.get(stage)
                entry["last_success_age_s"] = round(time.time() - last, 1) if last else None
            failures = [
                {
                    "stage": e.stage,
                    "outcome": e.outcome,
                    "cid": e.correlation_id,
                    "age_s": round(time.time() - e.at, 1),
                    "detail": e.detail[:200],
                }
                for e in reversed(self._recent_failures)
            ]
        return {"stages": by_stage, "recent_failures": failures}

    def failure_count(self, stage: Optional[str] = None) -> int:
        with self._lock:
            if stage is None:
                return len(self._recent_failures)
            return sum(1 for e in self._recent_failures if e.stage == stage)

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()
            self._latency_sum.clear()
            self._latency_n.clear()
            self._recent_failures.clear()
            self._last_success_at.clear()


memory_telemetry = MemoryTelemetry()
