import { useEffect, useRef, useState } from "react";
import { getGeminiKey, getOpenRouterKey } from "@/lib/api";

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
  {
    label: string;
    color: string;
    icon: string;
    sttLabel: string;
    ttsLabel: string;
    llmLabel: string;
  }
> = {
  gemini: {
    label: "Gemini Live",
    color: "#4285F4",
    icon: "🎙️",
    sttLabel: "WebSocket (native)",
    ttsLabel: "WebSocket (native)",
    llmLabel: "gemini-2.0-flash-exp",
  },
  openrouter: {
    label: "OpenRouter",
    color: "#F97316",
    icon: "🚀",
    sttLabel: "Browser SpeechRecognition",
    ttsLabel: "Browser speechSynthesis",
    llmLabel: "gemini-2.0-flash-lite",
  },
  sarvam: {
    label: "Sarvam AI",
    color: "#10B981",
    icon: "🇮🇳",
    sttLabel: "Sarvam STT (saaras:v1)",
    ttsLabel: "Sarvam TTS (Anushka)",
    llmLabel: "gemini-2.0-flash-lite",
  },
};

export function LatencyMeter({ visible = false, activeBrain = "gemini" }: LatencyMeterProps) {
  const [metrics, setMetrics] = useState<LatencyMetrics>({
    geminiConnect: null,
    firstToken: null,
    roundTrip: null,
    audioChunkInterval: null,
    backendAnalysis: null,
    memoryLayer: "live",
    geminiSetup: null,
    geminiGenStart: null,
    tokenThroughput: null,
    turnTokens: null,
  });
  const lastAudioChunk = useRef<number | null>(null);
  const [openRouterStats, setOpenRouterStats] = useState<any>(null);
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { type, value } = e.detail;
      if (typeof type === "object" && type !== null) {
        // Bulk update
        setMetrics((prev) => ({ ...prev, ...type }));
      } else {
        setMetrics((prev) => ({ ...prev, [type]: value }));
      }

      if (type === "audioChunkInterval") {
        lastAudioChunk.current = performance.now();
      }
    };

    window.addEventListener("aura:latency", handler as EventListener);
    return () => window.removeEventListener("aura:latency", handler as EventListener);
  }, []);

  useEffect(() => {
    if (activeBrain === "openrouter" || activeBrain === "sarvam") {
      const key = getOpenRouterKey();
      if (key) {
        fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: {
            Authorization: `Bearer ${key}`,
          },
        })
          .then((res) => res.json())
          .then((data) => {
            if (data && data.data) {
              setOpenRouterStats(data.data);
            }
          })
          .catch((err) => console.error("Failed to fetch OpenRouter key stats:", err));
      }
    }
  }, [activeBrain]);

  if (!visible) return null;

  const meta = PROVIDER_META[activeBrain] || PROVIDER_META.gemini;
  const getSarvamKey = () => sessionStorage.getItem("aura_sarvam_api_key") || "";

  const getColor = (value: number, warn: number, crit: number, higherIsBetter = false) => {
    if (higherIsBetter) {
      if (value >= warn) return "#1D9E75";
      if (value >= crit) return "#EF9F27";
      return "#E24B4A";
    }
    if (value >= crit) return "#E24B4A";
    if (value >= warn) return "#EF9F27";
    return "#1D9E75";
  };

  const renderRow = (
    label: string,
    value: number | null | string,
    unit: string,
    warn?: number,
    crit?: number,
    higherIsBetter = false,
    neutral = false,
  ) => {
    let color = "rgba(255,255,255,0.2)";
    if (typeof value === "string") {
      color = "rgba(255,255,255,0.7)";
    } else if (value !== null && !neutral && warn !== undefined && crit !== undefined) {
      color = getColor(value, warn, crit, higherIsBetter);
    } else if (value !== null && neutral) {
      color = "rgba(255,255,255,0.8)";
    }

    const displayValue =
      typeof value === "string" ? value : value !== null ? `${Math.round(value)}${unit}` : "—";

    return (
      <div
        key={label}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          marginBottom: "5px",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
        <span
          style={{ color, fontWeight: 500, fontSize: typeof value === "string" ? "9px" : "11px" }}
        >
          {displayValue}
        </span>
      </div>
    );
  };

  const sectionHeader = (text: string) => (
    <div
      style={{
        color: "rgba(255,255,255,0.3)",
        fontSize: "9px",
        letterSpacing: "0.05em",
        marginBottom: "6px",
        textTransform: "uppercase" as const,
      }}
    >
      {text}
    </div>
  );

  const divider = <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "8px 0" }} />;

  // ─── Provider-specific latency rows ───────────────────────────────
  const renderGeminiLatency = () => (
    <>
      {renderRow("WS connect", metrics.geminiConnect, "ms", 1500, 3000)}
      {renderRow("First token", metrics.firstToken, "ms", 800, 1500)}
      {renderRow("Round trip", metrics.roundTrip, "ms", 1000, 2000)}
      {renderRow("Audio chunk", metrics.audioChunkInterval, "ms", 50, 100)}
      {renderRow("Backend", metrics.backendAnalysis, "ms", 200, 500)}
      {divider}
      {sectionHeader("Gemini Model")}
      {renderRow("Setup latency", metrics.geminiSetup, "ms", 500, 1000)}
      {renderRow("Generation start", metrics.geminiGenStart, "ms", 500, 1000)}
      {renderRow("Token throughput", metrics.tokenThroughput, " tok/s", 30, 15, true)}
      {renderRow("Turn tokens", metrics.turnTokens, "", 0, 0, false, true)}
    </>
  );

  const renderOpenRouterLatency = () => (
    <>
      {renderRow("Backend", metrics.backendAnalysis, "ms", 200, 500)}
      {renderRow("First token", metrics.firstToken, "ms", 800, 1500)}
      {divider}
      {sectionHeader("Pipeline")}
      {renderRow("STT", meta.sttLabel, "", undefined, undefined, false, true)}
      {renderRow(
        "LLM",
        meta.llmLabel.split("/").pop() || "",
        "",
        undefined,
        undefined,
        false,
        true,
      )}
      {renderRow("TTS", meta.ttsLabel, "", undefined, undefined, false, true)}
      {renderRow("Token throughput", metrics.tokenThroughput, " tok/s", 30, 15, true)}
      {renderRow("Failover", "5-model cascade", "", undefined, undefined, false, true)}
    </>
  );

  const renderSarvamLatency = () => (
    <>
      {renderRow("Backend", metrics.backendAnalysis, "ms", 200, 500)}
      {renderRow("First token", metrics.firstToken, "ms", 800, 1500)}
      {divider}
      {sectionHeader("Pipeline")}
      {renderRow("STT", "Sarvam saaras:v1", "", undefined, undefined, false, true)}
      {renderRow("LLM", "Flash Lite (OR)", "", undefined, undefined, false, true)}
      {renderRow("TTS", "Anushka (22kHz)", "", undefined, undefined, false, true)}
      {renderRow("Token throughput", metrics.tokenThroughput, " tok/s", 30, 15, true)}
      {renderRow("Audio", "AudioContext decode", "", undefined, undefined, false, true)}
      {renderRow("Barge-in", "RMS > 0.018", "", undefined, undefined, false, true)}
    </>
  );

  // ─── API Key section ──────────────────────────────────────────────
  const renderKeySection = () => {
    if (activeBrain === "gemini") {
      return (
        <div
          style={{
            fontSize: "10px",
            color: "rgba(255,255,255,0.6)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Key:</span>
          <span>{getGeminiKey() ? `...${getGeminiKey()?.slice(-4)}` : "None"}</span>
        </div>
      );
    }

    // OpenRouter + Sarvam both use OR key for LLM
    return (
      <>
        <div
          style={{
            fontSize: "10px",
            color: "rgba(255,255,255,0.6)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>OR Key:</span>
          <span>{getOpenRouterKey() ? `...${getOpenRouterKey()?.slice(-4)}` : "None"}</span>
        </div>
        {activeBrain === "sarvam" && (
          <div
            style={{
              fontSize: "10px",
              color: "rgba(255,255,255,0.6)",
              display: "flex",
              justifyContent: "space-between",
              marginTop: "4px",
            }}
          >
            <span>Sarvam Key:</span>
            <span style={{ color: getSarvamKey() ? "rgba(255,255,255,0.8)" : "#E24B4A" }}>
              {getSarvamKey() ? `...${getSarvamKey().slice(-4)}` : "Missing!"}
            </span>
          </div>
        )}
        {openRouterStats && (
          <div
            style={{
              fontSize: "10px",
              color: "rgba(255,255,255,0.6)",
              display: "flex",
              justifyContent: "space-between",
              marginTop: "4px",
            }}
          >
            <span>Credits:</span>
            <span
              style={{
                color:
                  openRouterStats.limit_remaining !== null && openRouterStats.limit_remaining < 1
                    ? "#EF9F27"
                    : "rgba(255,255,255,0.8)",
              }}
            >
              {openRouterStats.limit_remaining !== null
                ? `$${openRouterStats.limit_remaining.toFixed(4)}`
                : openRouterStats.is_free_tier
                  ? "Free Tier"
                  : "Unlimited"}
            </span>
          </div>
        )}
      </>
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        borderRadius: "10px",
        padding: "10px 14px",
        fontFamily: "monospace",
        fontSize: "11px",
        zIndex: 9999,
        minWidth: "190px",
        border: `0.5px solid ${meta.color}33`,
      }}
    >
      {/* Provider badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "8px",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: meta.color,
            boxShadow: `0 0 6px ${meta.color}88`,
            display: "inline-block",
          }}
        />
        <span
          style={{
            color: meta.color,
            fontSize: "9px",
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            fontWeight: 600,
          }}
        >
          {meta.label} {meta.icon}
        </span>
      </div>

      {/* Memory layer */}
      <div
        style={{
          color: "rgba(255,255,255,0.4)",
          fontSize: "9px",
          marginBottom: "8px",
          textTransform: "uppercase" as const,
        }}
      >
        memory:{" "}
        <span style={{ color: "rgba(255,255,255,0.8)" }}>
          {metrics.memoryLayer === "live"
            ? "LIVE (No Context)"
            : metrics.memoryLayer === "seed"
              ? "SEED (Browser/Local)"
              : "DEEP (Cloud/Vector DB)"}
        </span>
      </div>

      {/* Provider-specific metrics */}
      {activeBrain === "gemini" && renderGeminiLatency()}
      {activeBrain === "openrouter" && renderOpenRouterLatency()}
      {activeBrain === "sarvam" && renderSarvamLatency()}

      {divider}

      {/* API Key Stats */}
      {sectionHeader(`Credentials (${meta.label})`)}
      {renderKeySection()}
    </div>
  );
}

// Global helper — call this anywhere to emit a latency event
export function emitLatency(
  type: keyof LatencyMetrics | Partial<LatencyMetrics>,
  value?: number | string,
) {
  window.dispatchEvent(new CustomEvent("aura:latency", { detail: { type, value } }));
}
