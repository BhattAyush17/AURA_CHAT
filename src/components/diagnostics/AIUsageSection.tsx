/**
 * AIUsageSection — observable provider call accounting for the diagnostics
 * panel. Renders per-provider aggregates (calls, success/failure/aborted,
 * reported vs estimated tokens, fallback/retry counts), per-model rollup,
 * recent requests with their call list, and the live provider calls.
 *
 * Never fabricates token counts — every figure is tagged with the source
 * (REPORTED / ESTIMATED / UNAVAILABLE) so the UI can label them honestly.
 */

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { DiagnosticSection } from "./DiagnosticSection";
import { detectRedundancies } from "@/telemetry/RedundancyDetector";
import {
  auraTelemetry,
  selectActiveLlm,
  selectMemoryAggregates,
  selectModelAggregates,
  selectProviderAggregates,
  selectRecentRequests,
  selectRequestTimeline,
  type TelemetrySnapshot,
} from "@/telemetry";

function formatTokenSource(s: "REPORTED" | "ESTIMATED" | "UNAVAILABLE"): string {
  if (s === "REPORTED") return "reported";
  if (s === "ESTIMATED") return "est.";
  return "—";
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function AIUsageSection() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(auraTelemetry.getSnapshot());
  useEffect(() => auraTelemetry.subscribe(setSnapshot), []);

  // Recompute the redundancy flags each snapshot, in case store state changed.
  const redundancies = detectRedundancies(
    snapshot.requests,
    snapshot.providerCalls,
    snapshot.memoryOps,
  );
  const redundancyKeys = new Set(redundancies.filter((r) => r.kind === "call").map((r) => r.id));

  const providers = selectProviderAggregates(snapshot.providerCalls);
  const models = selectModelAggregates(snapshot.providerCalls);
  const recentRequests = selectRecentRequests(snapshot.requests, 5);
  const active = selectActiveLlm(snapshot.providerCalls);
  const session = snapshot.session;
  const memoryAggs = selectMemoryAggregates(snapshot.memoryOps);

  return (
    <DiagnosticSection
      title="AI Usage"
      icon={Brain}
      badge={`${session.providerCallCount} calls · ${formatNumber(session.tokenInputTotal + session.tokenOutputTotal)} tokens`}
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Session totals */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block">
              Input tokens
            </span>
            <span className="text-sm font-bold text-foreground">
              {formatNumber(session.tokenInputTotal)}
            </span>
          </div>
          <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block">
              Output tokens
            </span>
            <span className="text-sm font-bold text-foreground">
              {formatNumber(session.tokenOutputTotal)}
            </span>
          </div>
          <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block">
              Calls (session)
            </span>
            <span className="text-sm font-bold text-foreground">{session.providerCallCount}</span>
          </div>
          <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block">
              Active LLM
            </span>
            <span className="text-sm font-bold text-foreground truncate block">
              {active ? `${active.provider}/${active.model}` : "—"}
            </span>
          </div>
        </div>

        {/* Per-provider breakdown */}
        {providers.length > 0 && (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-2">
              Provider breakdown
            </span>
            <div className="space-y-2">
              {providers.map((p) => (
                <div key={p.provider} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-foreground font-semibold">{p.provider}</span>
                    <span className="text-muted-foreground">
                      {p.calls} calls · {p.failures} err · {p.aborted} abort · {p.retryCount} retry
                      · {p.fallbackCount} fallback
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      in {formatNumber(p.inputTokens)}{" "}
                      <span className="text-amber-400/70">
                        [{formatTokenSource(p.inputSource)}]
                      </span>{" "}
                      · out {formatNumber(p.outputTokens)}{" "}
                      <span className="text-amber-400/70">
                        [{formatTokenSource(p.outputSource)}]
                      </span>
                    </span>
                    <span>{p.avgLatencyMs}ms avg</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-model breakdown */}
        {models.length > 0 && (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-2">
              Model breakdown
            </span>
            <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
              {models.map((m) => (
                <div
                  key={`${m.provider}:${m.model}`}
                  className="flex items-center justify-between text-[10px]"
                >
                  <span className="text-foreground truncate pr-2">
                    {m.provider}/{m.model}
                  </span>
                  <span className={m.failures > 0 ? "text-amber-400" : "text-muted-foreground"}>
                    {m.calls} calls {m.failures > 0 ? `· ${m.failures} fail` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Redundancy flags */}
        {redundancies.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
            <span className="text-[9px] uppercase tracking-widest text-amber-300 block mb-1">
              Suspicious duplicates (request-scoped)
            </span>
            {redundancies.slice(0, 4).map((r, i) => (
              <div key={i} className="text-[10px] text-foreground/90 py-0.5">
                · {r.reason}
              </div>
            ))}
          </div>
        )}

        {/* Recent requests with provider-call breakdown */}
        {recentRequests.length > 0 && (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-2">
              Recent requests
            </span>
            <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-2">
              {recentRequests.map((r) => {
                const tl = selectRequestTimeline(r, snapshot);
                return (
                  <div
                    key={r.requestId}
                    className="rounded-lg border border-border/20 bg-background/40 p-2"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span
                        className={
                          r.status === "error"
                            ? "text-red-400 font-bold"
                            : r.status === "running"
                              ? "text-amber-400 font-bold"
                              : "text-emerald-400"
                        }
                      >
                        {r.requestId} {r.turnId ? `· ${r.turnId}` : ""}
                      </span>
                      <span className="text-muted-foreground">
                        {r.latencyMs != null ? `${r.latencyMs}ms` : "—"}
                      </span>
                    </div>
                    {tl.filter((e) => e.type === "call").length > 0 && (
                      <div className="mt-1 text-[10px] text-muted-foreground space-y-0.5">
                        {tl
                          .filter((e) => e.type === "call")
                          .map((c) => {
                            const redFlag = redundancyKeys.has(r.requestId);
                            return (
                              <div key={c.id} className="flex items-center justify-between">
                                <span className={redFlag ? "text-amber-300" : "text-sky-300/90"}>
                                  {c.label}
                                  {c.status === "error" ? " (err)" : ""}
                                </span>
                                <span>
                                  {c.latencyMs != null ? `${Math.round(c.latencyMs)}ms` : "—"}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                    {tl.filter((e) => e.type === "memory").length > 0 && (
                      <div className="mt-1 text-[10px] text-muted-foreground space-y-0.5">
                        {tl
                          .filter((e) => e.type === "memory")
                          .map((m) => (
                            <div key={m.id} className="flex items-center justify-between">
                              <span className="text-amber-300/80">· {m.label}</span>
                              <span>
                                {m.latencyMs != null ? `${Math.round(m.latencyMs)}ms` : "—"}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live calls (running or latest) */}
        {snapshot.providerCalls.filter((c) => c.status === "aborted").slice(-2).length > 0 &&
          snapshot.providerCalls.every((c) => c.status === "aborted") && (
            <div className="text-[10px] text-amber-400">
              Live session in progress — token counters update as usage metadata arrives.
            </div>
          )}

        {/* Memory op count cross-link */}
        {memoryAggs.length > 0 && (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
              Memory ops (cross-link)
            </span>
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              {memoryAggs.slice(0, 3).map((m) => (
                <div key={`${m.type}:${m.service}`} className="flex items-center justify-between">
                  <span>
                    {m.type} · {m.service}
                  </span>
                  <span>
                    {m.count}× ({m.failures} err{m.duplicates > 0 ? ` · ${m.duplicates} dup` : ""})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DiagnosticSection>
  );
}
