/**
 * Pure selectors: snapshot → UI rows. These compute per-request aggregations
 * (token totals, call breakdown, memory breakdown) so the panel components
 * can render without re-implementing business logic.
 */

import type {
  CallStatus,
  MemoryOp,
  ProviderCall,
  ProviderName,
  TelemetryRequest,
  TelemetrySnapshot,
  TokenUsage,
} from "./types";

export interface ProviderAggregate {
  provider: ProviderName;
  calls: number;
  successes: number;
  failures: number;
  aborted: number;
  inputTokens: number;
  outputTokens: number;
  inputSource: TokenUsage["inputSource"];
  outputSource: TokenUsage["outputSource"];
  avgLatencyMs: number;
  fallbackCount: number;
  retryCount: number;
}

export interface ModelAggregate {
  provider: ProviderName;
  model: string;
  calls: number;
  failures: number;
}

export interface MemoryAggregate {
  type: MemoryOp["type"];
  service: MemoryOp["service"];
  count: number;
  successes: number;
  failures: number;
  resultCount: number;
  duplicates: number;
}

export interface RequestTimelineEntry {
  ts: number;
  type: "request" | "call" | "memory" | "operation";
  id: string;
  label: string;
  status?: string;
  service?: string;
  model?: string;
  latencyMs?: number;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function selectProviderAggregates(calls: ProviderCall[]): ProviderAggregate[] {
  const byKey = new Map<ProviderName, ProviderCall[]>();
  for (const c of calls) {
    const key = c.provider;
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }
  const out: ProviderAggregate[] = [];
  for (const [provider, list] of byKey) {
    const latencies: number[] = [];
    let success = 0;
    let fail = 0;
    let aborted = 0;
    let input = 0;
    let output = 0;
    let inSrc: TokenUsage["inputSource"] = "UNAVAILABLE";
    let outSrc: TokenUsage["outputSource"] = "UNAVAILABLE";
    let fallback = 0;
    let retry = 0;
    for (const c of list) {
      if (c.latencyMs != null) latencies.push(c.latencyMs);
      if (c.status === "success") success++;
      else if (c.status === "error") fail++;
      else if (c.status === "aborted") aborted++;
      if (c.kind === "FALLBACK") fallback++;
      if (c.kind === "RETRY") retry++;
      if (c.usage) {
        input += c.usage.inputTokens;
        output += c.usage.outputTokens;
        if (c.usage.inputSource === "REPORTED") inSrc = "REPORTED";
        else if (inSrc !== "REPORTED" && c.usage.inputSource === "ESTIMATED") inSrc = "ESTIMATED";
        if (c.usage.outputSource === "REPORTED") outSrc = "REPORTED";
        else if (outSrc !== "REPORTED" && c.usage.outputSource === "ESTIMATED")
          outSrc = "ESTIMATED";
      }
    }
    out.push({
      provider,
      calls: list.length,
      successes: success,
      failures: fail,
      aborted,
      inputTokens: input,
      outputTokens: output,
      inputSource: inSrc,
      outputSource: outSrc,
      avgLatencyMs: Math.round(avg(latencies)),
      fallbackCount: fallback,
      retryCount: retry,
    });
  }
  out.sort((a, b) => b.calls - a.calls);
  return out;
}

export function selectModelAggregates(calls: ProviderCall[]): ModelAggregate[] {
  const byKey = new Map<string, { provider: ProviderName; model: string; list: ProviderCall[] }>();
  for (const c of calls) {
    const k = `${c.provider}::${c.model}`;
    const e = byKey.get(k) ?? { provider: c.provider, model: c.model, list: [] };
    e.list.push(c);
    byKey.set(k, e);
  }
  const out: ModelAggregate[] = [];
  for (const { provider, model, list } of byKey.values()) {
    out.push({
      provider,
      model,
      calls: list.length,
      failures: list.filter((c) => c.status === "error").length,
    });
  }
  out.sort((a, b) => b.calls - a.calls);
  return out;
}

export function selectMemoryAggregates(ops: MemoryOp[]): MemoryAggregate[] {
  const byKey = new Map<
    string,
    { type: MemoryOp["type"]; service: MemoryOp["service"]; list: MemoryOp[] }
  >();
  for (const op of ops) {
    const k = `${op.type}::${op.service}`;
    const e = byKey.get(k) ?? { type: op.type, service: op.service, list: [] };
    e.list.push(op);
    byKey.set(k, e);
  }
  const out: MemoryAggregate[] = [];
  for (const { type, service, list } of byKey.values()) {
    out.push({
      type,
      service,
      count: list.length,
      successes: list.filter((o) => o.status === "success").length,
      failures: list.filter((o) => o.status === "error").length,
      resultCount: list.reduce((a, o) => a + (o.resultCount ?? 0), 0),
      duplicates: list.filter((o) => o.duplicate).length,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export function selectRecentRequests(requests: TelemetryRequest[], n = 6): TelemetryRequest[] {
  return requests.slice(-n).reverse();
}

export function selectRequestTimeline(
  req: TelemetryRequest,
  snapshot: TelemetrySnapshot,
): RequestTimelineEntry[] {
  const out: RequestTimelineEntry[] = [];
  out.push({
    ts: req.startedAt,
    type: "request",
    id: req.requestId,
    label: `request ${req.requestId}`,
    status: req.status,
    latencyMs: req.latencyMs,
  });
  for (const callId of req.providerCalls) {
    const c = snapshot.providerCalls.find((p) => p.callId === callId);
    if (!c) continue;
    out.push({
      ts: c.startedAt,
      type: "call",
      id: c.callId,
      label: `${c.provider}/${c.model} (${c.kind})`,
      status: c.status as CallStatus,
      service: c.provider,
      model: c.model,
      latencyMs: c.latencyMs,
    });
  }
  for (const opId of req.memoryOps) {
    const o = snapshot.memoryOps.find((m) => m.opId === opId);
    if (!o) continue;
    out.push({
      ts: o.startedAt,
      type: "memory",
      id: o.opId,
      label: `${o.type} · ${o.service}`,
      status: o.status,
      service: o.service,
      latencyMs: o.latencyMs,
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

export function selectActiveLlm(calls: ProviderCall[]): {
  provider: ProviderName;
  model: string;
} | null {
  const recent = [...calls].reverse().find((c) => c.status === "success" || c.status === "error");
  if (!recent) return null;
  return { provider: recent.provider, model: recent.model };
}
