/**
 * LatencyMeter — Live diagnostic overlay showing per-pipeline latency,
 * connectivity, and active subsystem info.
 *
 * Data sources:
 *   - Gemini pipeline: `aura:latency` custom events
 *   - OpenRouter/Sarvam: `connectionState` singleton (subscribed reactively)
 *   - Credentials: live reads from `getCredential()`
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getGeminiKey, getOpenRouterKey, getSarvamKey } from "@/lib/api";
import { getCredential } from "@/lib/credentials";
import { connectionState, type ConnectionState } from "@/config/connectionState";

// ─── Shared types ───────────────────────────────────────────────────

interface LatencyMetrics {
  geminiConnect: number | null;
  firstToken: number | null;
  roundTrip: number | null;
  audioChunkInterval: number | null;
  backendAnalysis: number | null;
  memoryLayer: "live" | "seed" | "deep";
  geminiSetup: number | null;
  geminiGenStart: number | null;
  tokenThroughput: number | null;
  turnTokens: number | null;
}

interface LatencyMeterProps {
  visible?: boolean;
  activeBrain?: "gemini" | "openrouter" | "sarvam";
}

// ─── Provider display config ────────────────────────────────────────

const PROVIDER_META: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  gemini: { label: "Gemini Live", color: "#4285F4", icon: "🎙️" },
  openrouter: { label: "OpenRouter", color: "#F97316", icon: "🚀" },
  sarvam: { label: "Sarvam AI", color: "#10B981", icon: "🇮🇳" },
};

// ─── Helpers ────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, unit = "ms") =>
  v != null ? `${Math.round(v)}${unit}` : "—";

const getColor = (value: number, warn: number, crit: number, higher = false) => {
  if (higher) {
    if (value >= warn) return "#1D9E75";
    if (value >= crit) return "#EF9F27";
    return "#E24B4A";
  }
  if (value >= crit) return "#E24B4A";
  if (value >= warn) return "#EF9F27";
  return "#1D9E75";
};

const valColor = (v: number | null | undefined, warn: number, crit: number, higher = false) =>
  v != null ? getColor(v, warn, crit, higher) : "rgba(255,255,255,0.2)";

// ─── Sub-components ─────────────────────────────────────────────────

function Row({
  label,
  value,
  color = "rgba(255,255,255,0.7)",
  pulse = false,
}: {
  label: string;
  value: string;
  color?: string;
  pulse?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 4 }}>
      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>{label}</span>
      <span
        style={{
          color,
          fontWeight: 500,
          fontSize: 10,
          transition: "color 0.3s",
          ...(pulse ? { animation: "latency-pulse 1.5s infinite" } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, letterSpacing: "0.05em", marginBottom: 5, marginTop: 8, textTransform: "uppercase" as const }}>
      {title}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "6px 0" }} />;
}

function StatusDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: active ? color : "rgba(255,255,255,0.15)",
        boxShadow: active ? `0 0 8px ${color}88` : "none",
        display: "inline-block",
        transition: "all 0.3s",
      }}
    />
  );
}

function KeyBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 3 }}>
      <span>{label}</span>
      <span style={{ color: present ? "#1D9E75" : "#E24B4A", fontWeight: 600 }}>
        {present ? "✓" : "✗"}
      </span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function LatencyMeter({ visible = false, activeBrain = "gemini" }: LatencyMeterProps) {
  const [metrics, setMetrics] = useState<LatencyMetrics>({
    geminiConnect: null, firstToken: null, roundTrip: null, audioChunkInterval: null,
    backendAnalysis: null, memoryLayer: "live", geminiSetup: null, geminiGenStart: null,
    tokenThroughput: null, turnTokens: null,
  });
  const [csLatencies, setCsLatencies] = useState<ConnectionState["latencies"]>({});
  const [csState, setCsState] = useState<Partial<ConnectionState>>({});
  const [orStats, setOrStats] = useState<any>(null);
  const [expanded, setExpanded] = useState(true);

  // Listen to Gemini's custom events
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { type, value } = e.detail;
      if (typeof type === "object" && type !== null) {
        setMetrics((prev) => ({ ...prev, ...type }));
      } else {
        setMetrics((prev) => ({ ...prev, [type]: value }));
      }
    };
    window.addEventListener("aura:latency", handler as EventListener);
    return () => window.removeEventListener("aura:latency", handler as EventListener);
  }, []);

  // Subscribe to connectionState for OR/Sarvam
  useEffect(() => {
    const unsub = connectionState.subscribe((state) => {
      setCsLatencies({ ...state.latencies });
      setCsState({
        active_llm: state.active_llm,
        active_voice_in: state.active_voice_in,
        active_voice_out: state.active_voice_out,
        active_memory_mode: state.active_memory_mode,
        active_embed_mode: state.active_embed_mode,
        sarvam_available: state.sarvam_available,
        render_reachable: state.render_reachable,
        supabase_connected: state.supabase_connected,
      });
    });
    return unsub;
  }, []);

  // Fetch OR key stats on mount
  useEffect(() => {
    if (activeBrain !== "gemini") {
      const key = getOpenRouterKey();
      if (key) {
        fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${key}` } })
          .then((r) => r.json())
          .then((d) => d?.data && setOrStats(d.data))
          .catch(() => {});
      }
    }
  }, [activeBrain]);

  if (!visible) return null;

  const meta = PROVIDER_META[activeBrain] || PROVIDER_META.gemini;

  // ─── Credential status ────────────────────────────────────────────
  const hasGemini = !!getGeminiKey();
  const hasOR = !!getOpenRouterKey();
  const hasSarvam = !!getSarvamKey();
  const hasCohere = !!getCredential("cohere_api_key");
  const hasPinecone = !!getCredential("pinecone_api_key");
  const hasRedis = !!getCredential("redis_url");
  const hasSupabase = !!getCredential("supabase_url") && !!getCredential("supabase_anon_key");

  // ─── Memory layer label ───────────────────────────────────────────
  const memLabel =
    activeBrain === "gemini"
      ? metrics.memoryLayer === "deep"
        ? "DEEP (Cloud/Vector)"
        : metrics.memoryLayer === "seed"
          ? "SEED (Browser)"
          : "LIVE (No Context)"
      : hasSupabase
        ? "CLOUD (Supabase)"
        : "LOCAL (Browser)";

  return (
    <>
      {/* Pulse animation */}
      <style>{`@keyframes latency-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          background: "rgba(0,0,0,0.82)",
          backdropFilter: "blur(12px)",
          borderRadius: 12,
          padding: expanded ? "12px 16px" : "8px 12px",
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 10,
          zIndex: 9999,
          minWidth: expanded ? 220 : 120,
          maxWidth: 260,
          border: `1px solid ${meta.color}22`,
          transition: "all 0.3s ease",
          cursor: "default",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: expanded ? 8 : 0, cursor: "pointer" }}
          onClick={() => setExpanded(!expanded)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot active={true} color={meta.color} />
            <span style={{ color: meta.color, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase" as const, fontWeight: 700 }}>
              {meta.label} {meta.icon}
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 8, transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
            ▼
          </span>
        </div>

        {expanded && (
          <>
            {/* ── Memory ── */}
            <Row label="Memory" value={memLabel} color="rgba(255,255,255,0.8)" />

            <Divider />

            {/* ── Pipeline-specific latency ── */}
            {activeBrain === "gemini" ? (
              <>
                <Section title="Latency" />
                <Row label="WS connect" value={fmt(metrics.geminiConnect)} color={valColor(metrics.geminiConnect, 1500, 3000)} />
                <Row label="Setup" value={fmt(metrics.geminiSetup)} color={valColor(metrics.geminiSetup, 500, 1000)} />
                <Row label="First token" value={fmt(metrics.firstToken)} color={valColor(metrics.firstToken, 800, 1500)} pulse={metrics.firstToken == null} />
                <Row label="Round trip" value={fmt(metrics.roundTrip)} color={valColor(metrics.roundTrip, 1000, 2000)} />
                <Row label="Audio chunk" value={fmt(metrics.audioChunkInterval)} color={valColor(metrics.audioChunkInterval, 50, 100)} />
                <Row label="Backend" value={fmt(metrics.backendAnalysis)} color={valColor(metrics.backendAnalysis, 200, 500)} />
                <Row label="Throughput" value={fmt(metrics.tokenThroughput, " tok/s")} color={valColor(metrics.tokenThroughput, 30, 15, true)} />

                <Divider />
                <Section title="Pipeline" />
                <Row label="STT" value="WebSocket (native)" />
                <Row label="LLM" value="Gemini 2.5 Flash" />
                <Row label="TTS" value="WebSocket (native)" />
                <Row label="VAD" value="Server-side auto" />
              </>
            ) : (
              <>
                <Section title="Latency" />
                <Row label="L1 Sensing" value={fmt(csLatencies.l1_sensing_ms)} color={valColor(csLatencies.l1_sensing_ms, 100, 300)} />
                <Row label="L2 Behavior" value={fmt(csLatencies.l2_behavior_ms)} color={valColor(csLatencies.l2_behavior_ms, 200, 500)} />
                <Row label="L3 Memory" value={fmt(csLatencies.l3_memory_ms)} color={valColor(csLatencies.l3_memory_ms, 150, 400)} />
                <Row label="L4 LLM" value={fmt(csLatencies.l4_llm_ms)} color={valColor(csLatencies.l4_llm_ms, 1000, 2500)} pulse={csLatencies.l4_llm_ms == null} />
                {activeBrain === "sarvam" && (
                  <Row label="L5 TTS" value={fmt(csLatencies.tts_ms)} color={valColor(csLatencies.tts_ms, 500, 1200)} />
                )}
                <Row label="Total" value={fmt(csLatencies.total_ms)} color={valColor(csLatencies.total_ms, 2000, 4000)} />

                <Divider />
                <Section title="Pipeline" />
                <Row label="STT" value={activeBrain === "sarvam" ? "Sarvam saaras:v2" : "Browser WebSpeech"} />
                <Row label="LLM" value={csState.active_llm || "Llama 3.3 70B"} />
                <Row label="TTS" value={activeBrain === "sarvam" ? "Sarvam bulbul:v3" : "Browser WebSpeech"} />
                <Row label="Barge-in" value="RMS > 0.018" />
                <Row label="Failover" value="5-model cascade" />
              </>
            )}

            <Divider />

            {/* ── Connectivity ── */}
            <Section title="Services" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
              {activeBrain === "gemini" ? (
                <KeyBadge label="Gemini" present={hasGemini} />
              ) : (
                <>
                  <KeyBadge label="OpenRouter" present={hasOR} />
                  {activeBrain === "sarvam" && <KeyBadge label="Sarvam" present={hasSarvam} />}
                </>
              )}
              <KeyBadge label="Cohere" present={hasCohere} />
              <KeyBadge label="Pinecone" present={hasPinecone} />
              <KeyBadge label="Redis" present={hasRedis} />
              <KeyBadge label="Supabase" present={hasSupabase} />
            </div>

            {/* OR credits */}
            {orStats && activeBrain !== "gemini" && (
              <>
                <Divider />
                <Row
                  label="OR Credits"
                  value={
                    orStats.limit_remaining != null
                      ? `$${orStats.limit_remaining.toFixed(4)}`
                      : orStats.is_free_tier
                        ? "Free Tier"
                        : "Unlimited"
                  }
                  color={
                    orStats.limit_remaining != null && orStats.limit_remaining < 1
                      ? "#EF9F27"
                      : "rgba(255,255,255,0.8)"
                  }
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Global emitter (unchanged API) ─────────────────────────────────
export function emitLatency(
  type: keyof LatencyMetrics | Partial<LatencyMetrics>,
  value?: number | string,
) {
  window.dispatchEvent(new CustomEvent("aura:latency", { detail: { type, value } }));
}
