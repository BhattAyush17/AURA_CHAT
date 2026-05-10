import { useEffect, useRef, useState } from "react";

interface LatencyMetrics {
  geminiConnect: number | null;
  firstToken: number | null;
  roundTrip: number | null;
  audioChunkInterval: number | null;
  backendAnalysis: number | null;
}

interface LatencyMeterProps {
  visible?: boolean;
}

export function LatencyMeter({ visible = false }: LatencyMeterProps) {
  const [metrics, setMetrics] = useState<LatencyMetrics>({
    geminiConnect: null,
    firstToken: null,
    roundTrip: null,
    audioChunkInterval: null,
    backendAnalysis: null,
  });
  const lastAudioChunk = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { type, value } = e.detail;
      setMetrics(prev => ({ ...prev, [type]: value }));

      if (type === "audioChunkInterval") {
        lastAudioChunk.current = performance.now();
      }
    };

    window.addEventListener("aura:latency", handler as EventListener);
    return () => window.removeEventListener("aura:latency", handler as EventListener);
  }, []);

  if (!visible) return null;

  const rows: { label: string; key: keyof LatencyMetrics; warn: number; crit: number }[] = [
    { label: "WS connect",    key: "geminiConnect",     warn: 1500, crit: 3000 },
    { label: "First token",   key: "firstToken",        warn: 800,  crit: 1500 },
    { label: "Round trip",    key: "roundTrip",         warn: 1000, crit: 2000 },
    { label: "Audio chunk",   key: "audioChunkInterval",warn: 50,   crit: 100  },
    { label: "Backend",       key: "backendAnalysis",   warn: 200,  crit: 500  },
  ];

  const getColor = (value: number, warn: number, crit: number) => {
    if (value >= crit) return "#E24B4A";
    if (value >= warn) return "#EF9F27";
    return "#1D9E75";
  };

  return (
    <div style={{
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
      minWidth: "170px",
      border: "0.5px solid rgba(255,255,255,0.1)",
    }}>
      <div style={{
        color: "rgba(255,255,255,0.4)",
        fontSize: "9px",
        letterSpacing: "0.08em",
        marginBottom: "8px",
        textTransform: "uppercase"
      }}>
        latency
      </div>

      {rows.map(({ label, key, warn, crit }) => {
        const value = metrics[key];
        const color = value !== null ? getColor(value, warn, crit) : "rgba(255,255,255,0.2)";
        return (
          <div key={key} style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            marginBottom: "5px",
          }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
            <span style={{ color, fontWeight: 500 }}>
              {value !== null ? `${Math.round(value)}ms` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Global helper — call this anywhere to emit a latency event
export function emitLatency(type: keyof LatencyMetrics, value: number) {
  window.dispatchEvent(new CustomEvent("aura:latency", { detail: { type, value } }));
}
