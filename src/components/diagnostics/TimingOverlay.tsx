import React, { useEffect, useState } from "react";
import { TimingTelemetry, TimingEvent } from "@/runtime/humanTiming/HumanResponseTimingEngine";

export const TimingOverlay: React.FC = () => {
  const [lastEvent, setLastEvent] = useState<TimingEvent | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const events = TimingTelemetry.getInstance().events;
      if (events.length > 0) {
        setLastEvent(events[events.length - 1]);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  if (!lastEvent) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 20,
      right: 20,
      width: 320,
      background: "rgba(10, 20, 30, 0.95)",
      border: "1px solid #1e3a8a",
      borderRadius: 12,
      padding: 16,
      color: "#e2e8f0",
      fontFamily: "monospace",
      fontSize: "11px",
      zIndex: 10000,
      backdropFilter: "blur(12px)",
      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.5)"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1e3a8a", paddingBottom: 8, marginBottom: 8 }}>
        <strong style={{ color: "#60a5fa" }}>HRTE Live Timing</strong>
        <span style={{ 
          background: "#1e3a8a",
          color: "#fff", 
          padding: "2px 6px", 
          borderRadius: 4, 
          textTransform: "uppercase",
          fontSize: "9px"
        }}>
          {lastEvent.stage}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "9px" }}>Intent</div>
          <div style={{ color: "#38bdf8", fontWeight: "bold" }}>{lastEvent.intent}</div>
        </div>
        <div>
          <div style={{ color: "#64748b", fontSize: "9px" }}>Momentum</div>
          <div style={{ color: "#34d399", fontWeight: "bold" }}>{lastEvent.momentum}</div>
        </div>
        <div>
          <div style={{ color: "#64748b", fontSize: "9px" }}>Confidence</div>
          <div style={{ color: lastEvent.confidence > 90 ? "#10b981" : "#fbbf24", fontWeight: "bold" }}>
            {lastEvent.confidence.toFixed(1)}%
          </div>
        </div>
        <div>
          <div style={{ color: "#64748b", fontSize: "9px" }}>Added Pause</div>
          <div style={{ color: lastEvent.expectedPause > 0 ? "#f472b6" : "#cbd5e1", fontWeight: "bold" }}>
            +{lastEvent.expectedPause.toFixed(0)} ms
          </div>
        </div>
      </div>
      
      <div style={{ borderTop: "1px solid #1e3a8a", paddingTop: 8, marginTop: 8 }}>
        <div style={{ color: "#64748b", fontSize: "9px" }}>Total Actual Wait</div>
        <div style={{ color: "#fff", fontSize: "12px", fontWeight: "bold" }}>{lastEvent.actualPause.toFixed(0)} ms</div>
      </div>
    </div>
  );
};
