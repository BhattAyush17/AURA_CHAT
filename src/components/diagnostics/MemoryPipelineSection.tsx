/**
 * MemoryPipelineSection — observability for the memory subsystem:
 *  - Per-(type, service) memory op counts (retrieval / write / update / profile)
 *  - Recent memory op timeline
 *  - Backend embedding/vector/FTS/supabase counters (server-side deltas)
 *  - Active vector store + capabilities
 *  - Redundancy flags for memory ops inside a request
 */

import { useEffect, useState } from "react";
import { Database, ListTree } from "lucide-react";
import { DiagnosticSection } from "./DiagnosticSection";
import {
  auraTelemetry,
  selectMemoryAggregates,
  type BackendCounterDelta,
  type MemoryOp,
  type TelemetryRequest,
  type TelemetrySnapshot,
} from "@/telemetry";

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function DeltaRow({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/10 last:border-0">
      <span className="text-muted-foreground text-[10px]">{label}</span>
      <span className="text-foreground text-[11px] font-semibold">
        {value}
        {sub ? <span className="text-muted-foreground/70 text-[9px] ml-1">{sub}</span> : null}
      </span>
    </div>
  );
}

export function MemoryPipelineSection() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(auraTelemetry.getSnapshot());
  useEffect(() => auraTelemetry.subscribe(setSnapshot), []);

  const memAggs = selectMemoryAggregates(snapshot.memoryOps);
  const recent = [...snapshot.memoryOps].slice(-12).reverse();
  const backend = snapshot.backend;
  const deltas: BackendCounterDelta | null = backend.deltas;

  const duplicates = snapshot.memoryOps.filter((m) => m.duplicate);

  return (
    <DiagnosticSection
      title="Memory Pipeline"
      icon={ListTree}
      badge={`${snapshot.session.memoryOpCount} ops`}
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Per (type, service) memory aggregates */}
        {memAggs.length > 0 ? (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-2">
              Pipeline by op
            </span>
            <div className="space-y-1.5">
              {memAggs.map((m) => (
                <div
                  key={`${m.type}:${m.service}`}
                  className="text-[10px] flex items-center justify-between"
                >
                  <span className="text-foreground truncate pr-2">
                    {m.type} <span className="text-muted-foreground/70">· {m.service}</span>
                  </span>
                  <span className={m.failures > 0 ? "text-amber-400" : "text-muted-foreground"}>
                    {m.count}× · {m.resultCount} results
                    {m.duplicates > 0 ? ` · ${m.duplicates} dup` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3 text-[10px] text-muted-foreground">
            No memory ops recorded this session yet.
          </div>
        )}

        {/* Duplicates flag */}
        {duplicates.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
            <span className="text-[9px] uppercase tracking-widest text-amber-300 block mb-1">
              Duplicate memory ops in same request
            </span>
            <div className="space-y-0.5 text-[10px] text-foreground/90">
              {duplicates.slice(-4).map((d) => (
                <div key={d.opId}>
                  · {d.type} · {d.service} (op {d.opId})
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Server-side counters (deltas since session) */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-3">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
            Backend counters (since session)
            <span className="ml-2 text-muted-foreground/70">
              {backend.available
                ? backend.fetchedAt
                  ? `updated ${timeAgo(backend.fetchedAt)} ago`
                  : ""
                : "unavailable"}
            </span>
          </span>
          {!backend.available ? (
            <p className="text-[10px] text-amber-400/80">
              Backend /api/telemetry is not reachable — vector/embedding/FTS/supabase counts are not
              refreshed.
            </p>
          ) : !deltas ? (
            <p className="text-[10px] text-muted-foreground">Awaiting first poll…</p>
          ) : (
            <div className="mt-1">
              <DeltaRow
                label="Embeddings generated"
                value={deltas.embeddings}
                sub="(gemini/cohere/fastembed)"
              />
              <DeltaRow
                label="Vector queries"
                value={deltas.vectorQueries}
                sub="(match_memories_v1+v2)"
              />
              <DeltaRow label="Vector upserts" value={deltas.vectorUpserts} sub="(memory_upsert)" />
              <DeltaRow label="FTS keyword searches" value={deltas.ftsQueries} />
              <DeltaRow
                label="Supabase reads"
                value={deltas.supabaseReads}
                sub="(aura_storage + health probe)"
              />
              <DeltaRow
                label="Supabase writes"
                value={deltas.supabaseWrites}
                sub="(aura_storage)"
              />
              <DeltaRow
                label="Pinecone key events"
                value={deltas.pineconeConfigures}
                sub="(server-side key ingest)"
              />
              <DeltaRow
                label="API requests"
                value={deltas.apiRequests}
                sub="(analyze/speculate/memory)"
              />
              <DeltaRow label="Failures" value={deltas.failures} sub="(server-recorded)" />
            </div>
          )}
        </div>

        {/* Capabilities */}
        {backend.capabilities && (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
              Backend capabilities
            </span>
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <div className="flex items-center justify-between">
                <span>Active vector store</span>
                <span className="text-foreground font-semibold">
                  {backend.capabilities.activeVectorStore}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Embedding provider</span>
                <span className="text-foreground font-semibold">
                  {backend.capabilities.embeddingProvider}
                  {backend.capabilities.embeddingAvailable ? (
                    <span className="text-emerald-400 ml-1">(available)</span>
                  ) : (
                    <span className="text-amber-400 ml-1">(FTS fallback)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Supabase (server)</span>
                <span
                  className={
                    backend.capabilities.supabaseConfigured ? "text-emerald-400" : "text-amber-400"
                  }
                >
                  {backend.capabilities.supabaseConfigured ? "configured" : "not configured"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>ChromaDB (behavior)</span>
                <span
                  className={
                    backend.capabilities.chromaReady ? "text-emerald-400" : "text-amber-400"
                  }
                >
                  {backend.capabilities.chromaReady ? "ready" : "initialising"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pinecone</span>
                <span
                  className={
                    backend.capabilities.pineconeActive
                      ? "text-emerald-400"
                      : "text-muted-foreground"
                  }
                >
                  {backend.capabilities.pineconeActive
                    ? "active"
                    : backend.capabilities.pineconeConfigured
                      ? "key accepted (not active)"
                      : "not configured"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Recent memory ops timeline */}
        {recent.length > 0 && (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
              Recent memory ops
            </span>
            <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">
              {recent.map((op: MemoryOp) => (
                <OpRow
                  key={op.opId}
                  op={op}
                  request={snapshot.requests.find((r) => r.requestId === op.requestId)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground/70">
          Note: backend counters are process-wide server totals — deltas here are computed against
          the first successful poll of the current AURA session, so a backend restart transparently
          re-baselines.
        </div>
      </div>
    </DiagnosticSection>
  );
}

function OpRow({ op, request }: { op: MemoryOp; request?: TelemetryRequest }) {
  return (
    <div className="flex items-center justify-between text-[10px] py-0.5">
      <span className="text-foreground/90 truncate pr-2">
        {op.type} · {op.service} {op.duplicate ? "(dup)" : ""}
      </span>
      <span className="text-muted-foreground">
        {op.resultCount != null ? `${op.resultCount}r · ` : ""}
        {op.latencyMs != null ? `${Math.round(op.latencyMs)}ms` : "—"}
        {request?.requestId ? ` · ${request.requestId}` : ""}
      </span>
    </div>
  );
}

// keep the unused import warning quiet when backend is unavailable
void formatNumber;
void Database;
