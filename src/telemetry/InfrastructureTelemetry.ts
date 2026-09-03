/**
 * InfrastructureTelemetry — derives the per-user infrastructure status and
 * reconciles it with the backend's /api/telemetry counters.
 *
 *  - Frontend status is computed from credential presence (booleans only) so
 *    nothing sensitive ever reaches the panel.
 *  - Backend status is fetched from the existing behavior-engine
 *    `/api/telemetry` endpoint. Polling is opt-in (only while the drawer is
 *    open) and the polling code never causes LLM/provider calls of its own.
 *  - Per-session deltas are computed against the first successful poll, so
 *    a backend restart transparently re-baselines the deltas.
 */

import { auraTelemetry } from "./RuntimeTelemetry";
import { ENDPOINTS } from "@/config/api";
import { CREDENTIAL_KEYS, hasSupabaseCredentials, hasUserKey } from "@/lib/credentials";
import { isValidKey, getGeminiKey, getOpenRouterKey, getSarvamKey } from "@/lib/api";
import type { BackendCapabilities, BackendCounterDelta, BackendTelemetry } from "./types";

export interface InfraRow {
  id:
    | "gemini"
    | "openrouter"
    | "sarvam"
    | "groq"
    | "cohere"
    | "pinecone"
    | "supabase"
    | "embedding_provider"
    | "vector_store"
    | "memory_backend";
  label: string;
  configured: boolean;
  valid: boolean;
  scope: "client" | "server";
  note?: string;
}

interface BackendCounters {
  embedding_provider: string;
  embedding_available: boolean;
  chroma_ready: boolean;
  active_vector_store: string;
  pinecone: { key_configured: boolean; active: boolean };
  supabase_configured: boolean;
  counters: {
    totals: { success: number; failure: number; total: number };
    by_service: Record<string, Record<string, { success: number; failure: number }>>;
  };
}

function getGeminiUserRow(): { configured: boolean; valid: boolean } {
  const v = getGeminiKey();
  return { configured: !!v, valid: isValidKey(v, "gemini") };
}

function getOpenRouterUserRow(): { configured: boolean; valid: boolean } {
  const v = getOpenRouterKey();
  return { configured: !!v, valid: isValidKey(v, "openrouter") };
}

function getSarvamUserRow(): { configured: boolean; valid: boolean } {
  const v = getSarvamKey();
  return { configured: !!v, valid: isValidKey(v, "sarvam") };
}

function credentialRow(id: CredentialLike, label: string, note?: string): InfraRow {
  const present = hasUserKey(id);
  const stored = ((): boolean => {
    if (id === "aura_gemini_api_key") return getGeminiUserRow().valid;
    if (id === "openrouter_api_key") return getOpenRouterUserRow().valid;
    if (id === "sarvam_api_key") return getSarvamUserRow().valid;
    return present;
  })();
  return {
    id:
      id === "pinecone_api_key"
        ? "pinecone"
        : id === "cohere_api_key"
          ? "cohere"
          : id === "groq_api_key"
            ? "groq"
            : "supabase",
    label,
    configured: present,
    valid: stored,
    scope: "client",
    note,
  };
}

type CredentialLike = (typeof CREDENTIAL_KEYS)[number];

/** Build the per-user client-side infrastructure status (booleans only). */
export function getInfrastructureStatus(): InfraRow[] {
  return [
    {
      id: "gemini",
      label: "Gemini (Live + Embedding)",
      ...getGeminiUserRow(),
      scope: "client",
      note: "Used for live voice session and (server-side) embeddings.",
    },
    {
      id: "openrouter",
      label: "OpenRouter (fallback text)",
      ...getOpenRouterUserRow(),
      scope: "client",
      note: "Used by OpenRouter-direct path and model failover.",
    },
    {
      id: "sarvam",
      label: "Sarvam (Indian language)",
      ...getSarvamUserRow(),
      scope: "client",
    },
    credentialRow("groq_api_key", "Groq (experimental)", "Optional — not on critical path."),
    credentialRow(
      "cohere_api_key",
      "Cohere (embedding fallback)",
      "Optional — used when Gemini embeddings unavailable.",
    ),
    credentialRow(
      "pinecone_api_key",
      "Pinecone",
      "Server accepts the key but the active vector store is Supabase pgvector.",
    ),
    {
      id: "supabase",
      label: "Supabase (memory backend)",
      configured: hasSupabaseCredentials(),
      valid: hasSupabaseCredentials(),
      scope: "client",
      note: "Cloud sync; when absent, the browser-only seed store is used.",
    },
  ];
}

// ── Backend fetch + delta computation ──────────────────────────────

let baseline: number[] | null = null; // first successful poll snapshot
let pollTimer: ReturnType<typeof setInterval> | null = null;
let fetching = false;
let consecutiveErrors = 0;

const ZERO: BackendCounterDelta = {
  embeddings: 0,
  vectorQueries: 0,
  vectorUpserts: 0,
  ftsQueries: 0,
  supabaseReads: 0,
  supabaseWrites: 0,
  pineconeConfigures: 0,
  apiRequests: 0,
  failures: 0,
};

function sumOps(
  byService: Record<string, Record<string, { success: number; failure: number }>>,
  service: string,
  ops: string[],
): { success: number; failure: number } {
  const svc = byService[service];
  if (!svc) return { success: 0, failure: 0 };
  let success = 0;
  let failure = 0;
  for (const op of ops) {
    const e = svc[op];
    if (!e) continue;
    success += e.success;
    failure += e.failure;
  }
  return { success, failure };
}

function currentAbs(
  by: Record<string, Record<string, { success: number; failure: number }>>,
): number[] {
  const embeddingOps = ["gemini", "cohere", "fastembed"];
  const e = sumOps(by, "embeddings", embeddingOps);
  const vq = sumOps(by, "vector", ["match_memories_v1", "match_memories_v2"]);
  const vu = sumOps(by, "vector", ["memory_upsert"]);
  const fts = sumOps(by, "fts", ["keyword_search"]);
  const sr = sumOps(by, "supabase", ["read_aura_storage", "health_probe"]);
  const sw = sumOps(by, "supabase", ["write_aura_storage"]);
  const pc = sumOps(by, "pinecone", ["key_configured"]);
  const apiOps = Object.keys(by.api ?? {});
  const api = sumOps(by, "api", apiOps);
  const failures =
    (by.embeddings ? Object.values(by.embeddings).reduce((a, b) => a + b.failure, 0) : 0) +
    (by.vector ? Object.values(by.vector).reduce((a, b) => a + b.failure, 0) : 0) +
    (by.fts ? Object.values(by.fts).reduce((a, b) => a + b.failure, 0) : 0) +
    (by.supabase ? Object.values(by.supabase).reduce((a, b) => a + b.failure, 0) : 0) +
    (by.api ? Object.values(by.api).reduce((a, b) => a + b.failure, 0) : 0) +
    (by.pinecone ? Object.values(by.pinecone).reduce((a, b) => a + b.failure, 0) : 0);
  return [
    e.success,
    vq.success,
    vu.success,
    fts.success,
    sr.success,
    sw.success,
    pc.success,
    api.success,
    failures,
  ];
}

function categoryDeltas(current: number[], base: number[] | null): BackendCounterDelta {
  if (!base) return { ...ZERO };
  return {
    embeddings: current[0] - base[0],
    vectorQueries: current[1] - base[1],
    vectorUpserts: current[2] - base[2],
    ftsQueries: current[3] - base[3],
    supabaseReads: current[4] - base[4],
    supabaseWrites: current[5] - base[5],
    pineconeConfigures: current[6] - base[6],
    apiRequests: current[7] - base[7],
    failures: current[8] - base[8],
  };
}

function capabilitiesFromCounters(payload: BackendCounters): BackendCapabilities {
  return {
    embeddingProvider: payload.embedding_provider,
    embeddingAvailable: payload.embedding_available,
    activeVectorStore: payload.active_vector_store,
    pineconeConfigured: !!payload.pinecone?.key_configured,
    pineconeActive: !!payload.pinecone?.active,
    supabaseConfigured: !!payload.supabase_configured,
    chromaReady: !!payload.chroma_ready,
  };
}

/** One-shot fetch + snapshot update. */
export async function pollBackendTelemetry(): Promise<void> {
  if (fetching) return;
  fetching = true;
  try {
    const res = await fetch(ENDPOINTS.telemetry, {
      method: "GET",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const payload: BackendCounters = await res.json();
    const by = payload.counters?.by_service ?? {};
    const abs = currentAbs(by);
    if (!baseline) {
      baseline = abs;
    } else if (abs.some((v, i) => v < baseline![i])) {
      // server restart detected — re-baseline
      baseline = abs;
    }
    const capabilities = capabilitiesFromCounters(payload);
    const totals: Record<string, { success: number; failure: number }> = {};
    for (const [service, ops] of Object.entries(by)) {
      for (const [op, e] of Object.entries(ops)) {
        totals[`${service}:${op}`] = { success: e.success, failure: e.failure };
      }
    }
    const recentOps =
      (
        payload.counters as unknown as {
          recent_ops?: Array<{
            service: string;
            op: string;
            status: string;
            latency_ms: number | null;
            ts: number;
          }>;
        }
      )?.recent_ops ?? [];
    const snapshot: BackendTelemetry = {
      available: true,
      fetchedAt: Date.now(),
      capabilities,
      deltas: categoryDeltas(abs, baseline),
      totalsByOp: totals,
      recentOps,
    };
    auraTelemetry.setBackendTelemetry(snapshot);
    consecutiveErrors = 0;
  } catch {
    consecutiveErrors += 1;
    auraTelemetry.setBackendTelemetry({
      available: false,
      capabilities: null,
      deltas: null,
      totalsByOp: {},
      recentOps: [],
    });
  } finally {
    fetching = false;
  }
}

/** Start polling at 4s cadence. Re-entrant safe. */
export function startInfraPolling(intervalMs = 4000): void {
  if (typeof window === "undefined") return;
  if (pollTimer) return;
  void pollBackendTelemetry();
  pollTimer = setInterval(() => {
    if (consecutiveErrors > 5) {
      stopInfraPolling();
      return;
    }
    void pollBackendTelemetry();
  }, intervalMs);
}

export function stopInfraPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function resetInfraPollingBaseline(): void {
  baseline = null;
}
