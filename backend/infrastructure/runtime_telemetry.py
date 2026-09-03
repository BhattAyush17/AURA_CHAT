"""
AURA Runtime Telemetry — bounded in-memory runtime counters.

Observability-only. Records op *counts*, *status*, and *latencies* — never
payloads, never credentials, never user content. Exposed via GET /api/telemetry
so the frontend Runtime Diagnostics panel can answer honest questions about
server-side work (embeddings generated, vector queries, Supabase/Pinecone ops,
FTS fallbacks) without shipping any secrets or content to the browser.

Counters are monotonic for the process lifetime. The frontend Runtime
Diagnostics panel correlates these aggregates with its own per-session /
per-request timelines so per-user isolation is preserved in the UI while the
backend never stores or returns any per-user content.
"""

import time
import threading
from collections import deque
from dataclasses import dataclass, field

from backend.infrastructure.logging import get_logger

log = get_logger("runtime_telemetry")

RECENT_HISTORY_LIMIT = 200


@dataclass
class _OpSnapshot:
    service: str
    op: str
    status: str  # success | failure
    latency_ms: float | None = None
    ts: float = field(default_factory=time.time)


class RuntimeTelemetry:
    """Thread-safe singleton aggregator of server-side runtime counters."""

    def __init__(self):
        self._lock = threading.Lock()
        self._started_at = time.time()
        # (service, op, status) -> {"count": int, "lat_ms": [... ]}
        self._counts: dict[tuple[str, str, str], dict] = {}
        self._latencies: dict[tuple[str, str, str], deque[float]] = {}
        self._recent: deque[_OpSnapshot] = deque(maxlen=RECENT_HISTORY_LIMIT)
        # Per serice/op running latency aggregates (min/max/avg via accumulators)
        self._agg: dict[tuple[str, str, str], dict] = {}

    def record(
        self,
        service: str,
        op: str,
        status: str = "success",
        latency_ms: float | None = None,
    ) -> None:
        """Record a single operation outcome. content-free."""
        key = (service, op, status if status else "success")
        with self._lock:
            entry = self._counts.setdefault(key, {"success": 0, "failure": 0})
            bucket = "success" if (not status or status == "success") else "failure"
            entry[bucket] += 1

            if latency_ms is not None:
                bucket_key = (key[0], key[1], key[2])
                hist = self._latencies.setdefault(bucket_key, deque(maxlen=256))
                hist.append(latency_ms)
                agg = self._agg.setdefault(
                    bucket_key, {"sum": 0.0, "count": 0, "min": None, "max": 0.0}
                )
                agg["sum"] += latency_ms
                agg["count"] += 1
                agg["max"] = max(agg["max"], latency_ms)
                agg["min"] = latency_ms if agg["min"] is None else min(agg["min"], latency_ms)

            self._recent.append(
                _OpSnapshot(
                    service=service,
                    op=op,
                    status=("success" if (not status or status == "success") else "failure"),
                    latency_ms=latency_ms,
                    ts=time.time(),
                )
            )

    def snapshot(self) -> dict:
        """Immutable snapshot of counters + recent ops. No content, no credentials."""
        with self._lock:
            services: dict[str, dict] = {}
            aggregates: dict[str, dict] = {}
            total_success = 0
            total_failure = 0

            for (service, op, status), entry in self._counts.items():
                bucket = services.setdefault(service, {})
                op_entry = bucket.setdefault(
                    op,
                    {"success": 0, "failure": 0, "last_latency_ms": None},
                )
                op_entry["success"] += entry.get("success", 0)
                op_entry["failure"] += entry.get("failure", 0)
                total_success += entry.get("success", 0)
                total_failure += entry.get("failure", 0)

            for (service, op, status), hist in self._latencies.items():
                agg = self._agg.get((service, op, status))
                if not agg or agg["count"] == 0:
                    continue
                avg = agg["sum"] / agg["count"]
                aggregates[f"{service}:{op}:{status}"] = {
                    "avg_ms": round(avg, 2),
                    "min_ms": round(agg["min"], 2) if agg["min"] is not None else None,
                    "max_ms": round(agg["max"], 2),
                    "sample_count": agg["count"],
                }

            recent = [
                {
                    "service": r.service,
                    "op": r.op,
                    "status": r.status,
                    "latency_ms": r.latency_ms,
                    "ts": r.ts,
                }
                for r in list(self._recent)[-50:]
            ]

            return {
                "service": "runtime",
                "version": 2,
                "started_at_epoch": self._started_at,
                "uptime_s": round(time.time() - self._started_at, 1),
                "totals": {
                    "success": total_success,
                    "failure": total_failure,
                    "total": total_success + total_failure,
                },
                "by_service": services,
                "latency_aggregates": aggregates,
                "recent_ops": recent,
            }

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()
            self._latencies.clear()
            self._agg.clear()
            self._recent.clear()
            self._started_at = time.time()


def now_ms() -> float:
    return time.monotonic() * 1000.0


def timing(service: str, op: str):
    """Context-manager: record success/failure + latency on exit.

    Usage:
        with timing("embeddings", "gemini") as t:
            vector = await provider.embed(text)
        # t.status can be set to "failure" to override (defaults to success)
    """

    class _Timer:
        def __enter__(self):
            self._t0 = now_ms()
            self.status = "success"
            return self

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self.status = "failure"
            runtime_telemetry.record(service, op, status=self.status, latency_ms=now_ms() - self._t0)
            return False

    return _Timer()


# Module-level singleton for the whole process.
runtime_telemetry = RuntimeTelemetry()