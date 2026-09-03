/**
 * RedundancyDetector — observability-side heuristics that flag suspicious
 * duplicate work inside a single logical request (e.g. the same memory write
 * or the same vector query running multiple times for one turn). It only marks
 * records with a `duplicate` flag; it never changes runtime behavior.
 */

import type { MemoryOp, ProviderCall, TelemetryRequest } from "./types";

const REDUNDANCY_WINDOW_MS = 1200;

export interface RedundancyFlag {
  id: string;
  kind: "memory" | "call";
  reason: string;
}

/**
 * Detect likely-redundant operations within each request:
 *  - two+ memory ops of the same (type, service) inside a short window
 *  - a provider call labeled PRIMARY whose model already ran in the same
 *    request (indicates the caller mislabeled retries as primary)
 */
export function detectRedundancies(
  requests: TelemetryRequest[],
  calls: ProviderCall[],
  memoryOps: MemoryOp[],
): RedundancyFlag[] {
  const flags: RedundancyFlag[] = [];

  for (const req of requests.slice(-8)) {
    // ── memory ops ─────────────────────────────────────────────
    const byKey = new Map<string, MemoryOp[]>();
    for (const m of req.memoryOps) {
      const op = memoryOps.find((o) => o.opId === m);
      if (!op) continue;
      const key = `${op.type}:${op.service}`;
      const list = byKey.get(key) ?? [];
      list.push(op);
      byKey.set(key, list);
    }
    for (const [key, list] of byKey) {
      if (list.length < 2) continue;
      const window = list[list.length - 1].startedAt - list[0].startedAt;
      if (window <= REDUNDANCY_WINDOW_MS) {
        for (const op of list.slice(1)) {
          op.duplicate = true;
          flags.push({
            id: op.opId,
            kind: "memory",
            reason: `Duplicate ${key}×${list.length} within ${window}ms in ${req.requestId}`,
          });
        }
      }
    }

    // ── provider calls ──────────────────────────────────────────
    const primaryModels = new Map<string, number>();
    for (const callId of req.providerCalls) {
      const call = calls.find((c) => c.callId === callId);
      if (!call) continue;
      if (call.kind === "PRIMARY") {
        primaryModels.set(call.model, (primaryModels.get(call.model) ?? 0) + 1);
      }
    }
    for (const [model, count] of primaryModels) {
      if (count > 1) {
        flags.push({
          id: req.requestId,
          kind: "call",
          reason: `${count}× PRIMARY calls on ${model} in ${req.requestId} (should be RETRY/FALLBACK)`,
        });
      }
    }
  }

  return flags;
}
