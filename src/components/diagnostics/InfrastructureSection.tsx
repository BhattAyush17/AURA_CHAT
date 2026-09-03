/**
 * InfrastructureSection — per-user infrastructure status.
 *
 * Renders:
 *  - Per-user credential status (booleans only — keys never appear here)
 *  - Active memory backend (supabase vs local)
 *  - Backend capabilities (vector store, embedding provider, ChromaDB, Pinecone)
 *  - Cross-check between the user-facing credential state and the server's
 *    observation of Pinecone / Supabase availability.
 */

import { useEffect, useState } from "react";
import { Server, ShieldCheck, ShieldOff } from "lucide-react";
import { DiagnosticSection } from "./DiagnosticSection";
import {
  auraTelemetry,
  getInfrastructureStatus,
  type InfraRow,
  type TelemetrySnapshot,
} from "@/telemetry";
import type { CredentialKey } from "@/lib/credentials";

function statusBadge(row: InfraRow): { label: string; tone: "ok" | "warn" | "off" } {
  if (!row.configured) return { label: "not configured", tone: "off" };
  if (!row.valid) return { label: "invalid", tone: "warn" };
  return { label: "ready", tone: "ok" };
}

function toneClass(tone: "ok" | "warn" | "off"): string {
  if (tone === "ok") return "text-emerald-400";
  if (tone === "warn") return "text-amber-400";
  return "text-muted-foreground";
}

function toneBg(tone: "ok" | "warn" | "off"): string {
  if (tone === "ok") return "bg-emerald-500/10";
  if (tone === "warn") return "bg-amber-500/15";
  return "bg-foreground/10";
}

const ROW_ORDER: {
  key: CredentialKey | "supabase" | "embedding_provider" | "vector_store" | "memory_backend";
  label: string;
}[] = [
  { key: "aura_gemini_api_key", label: "Gemini (Live + Embedding server-side)" },
  { key: "openrouter_api_key", label: "OpenRouter (text LLM + failover)" },
  { key: "sarvam_api_key", label: "Sarvam (Indian-language STT/TTS)" },
  { key: "groq_api_key", label: "Groq (experimental, optional)" },
  { key: "cohere_api_key", label: "Cohere (server-side embedding fallback)" },
  { key: "pinecone_api_key", label: "Pinecone (server-side key ingest)" },
  { key: "supabase", label: "Supabase (cloud sync, server-side key)" },
];

export function InfrastructureSection() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(auraTelemetry.getSnapshot());
  const [clientRows, setClientRows] = useState<InfraRow[]>(getInfrastructureStatus());
  useEffect(() => auraTelemetry.subscribe(setSnapshot), []);
  useEffect(() => {
    const recompute = () => setClientRows(getInfrastructureStatus());
    recompute();
    if (typeof window !== "undefined") {
      window.addEventListener("aura_credentials_updated", recompute);
      return () => window.removeEventListener("aura_credentials_updated", recompute);
    }
  }, []);

  const backend = snapshot.backend;
  const capabilities = backend.capabilities;
  const matchingRow = (key: (typeof ROW_ORDER)[number]["key"]): InfraRow | undefined =>
    clientRows.find((r) => r.id === key);

  return (
    <DiagnosticSection
      title="Infrastructure"
      icon={Server}
      badge={backend.available ? "backend reachable" : "backend offline"}
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Per-user status */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-3">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-2">
            Per-user credentials
          </span>
          <div className="space-y-1.5">
            {ROW_ORDER.map(({ key, label }) => {
              const row = matchingRow(key);
              if (!row) return null;
              const badge = statusBadge(row);
              const Icon = badge.tone === "ok" ? ShieldCheck : ShieldOff;
              return (
                <div key={key} className="flex items-center justify-between text-[10px]">
                  <span className="text-foreground/90 flex items-center gap-1.5">
                    <Icon className={`h-3 w-3 ${toneClass(badge.tone)}`} strokeWidth={1.75} />
                    {label}
                  </span>
                  <span
                    className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded ${toneBg(
                      badge.tone,
                    )} ${toneClass(badge.tone)}`}
                  >
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active memory backend (client-side decision) */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-3">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
            Active memory backend
          </span>
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex items-center justify-between">
              <span>Client decision</span>
              <span className="text-foreground font-semibold">
                {matchingRow("supabase")?.configured
                  ? "Supabase (preferred)"
                  : "Local Browser (SEED)"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Server decision</span>
              <span
                className={
                  capabilities?.supabaseConfigured
                    ? "text-emerald-400 font-semibold"
                    : "text-amber-400 font-semibold"
                }
              >
                {capabilities?.supabaseConfigured ? "Supabase ready" : "Supabase unavailable"}
              </span>
            </div>
          </div>
        </div>

        {/* Backend capabilities */}
        {capabilities && (
          <div className="rounded-xl border border-border/30 bg-background/40 p-3">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
              Server-side capabilities
            </span>
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <div className="flex items-center justify-between">
                <span>Embedding provider</span>
                <span className="text-foreground font-semibold">
                  {capabilities.embeddingProvider}
                  {capabilities.embeddingAvailable ? (
                    <span className="text-emerald-400 ml-1">(available)</span>
                  ) : (
                    <span className="text-amber-400 ml-1">(FTS fallback)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Active vector store</span>
                <span className="text-foreground font-semibold">
                  {capabilities.activeVectorStore}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>ChromaDB (behavior engine)</span>
                <span className={capabilities.chromaReady ? "text-emerald-400" : "text-amber-400"}>
                  {capabilities.chromaReady ? "ready" : "initialising"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pinecone key</span>
                <span
                  className={
                    capabilities.pineconeActive
                      ? "text-emerald-400"
                      : capabilities.pineconeConfigured
                        ? "text-amber-400"
                        : "text-muted-foreground"
                  }
                >
                  {capabilities.pineconeActive
                    ? "active"
                    : capabilities.pineconeConfigured
                      ? "accepted (not the active store)"
                      : "not configured"}
                </span>
              </div>
            </div>
            <p className="mt-2 text-[9px] text-muted-foreground/80">
              Pinecone keys are accepted and forwarded by the server, but the live vector store is
              Supabase pgvector (match_memories_v2). The key is recorded only for parity with the
              existing behavior-engine credential ingestion.
            </p>
          </div>
        )}

        {!backend.available && (
          <p className="text-[10px] text-amber-400/80">
            Backend telemetry endpoint is not reachable. Per-user credentials are still shown above.
          </p>
        )}
      </div>
    </DiagnosticSection>
  );
}
