import React, { useEffect, useState } from "react";
import { FlightRecorder, FlightEvent, FlightStage } from "@/diagnostics/FlightRecorder";

export const FlightRecorderOverlay: React.FC = () => {
  const [events, setEvents] = useState<FlightEvent[]>([]);
  const [stage, setStage] = useState<FlightStage>("idle");

  useEffect(() => {
    const recorder = FlightRecorder.getInstance();
    const unsubscribe = recorder.subscribe((newEvents, newStage) => {
      setEvents(newEvents);
      setStage(newStage);
    });
    return unsubscribe;
  }, []);

  const currentTurnId = FlightRecorder.getInstance().getCurrentTurnId();
  const currentTurnEvents = events.filter(e => e.turnId === currentTurnId);
  
  const totalTurnTime = currentTurnEvents.reduce((sum, e) => sum + e.duration, 0);

  return (
    <div style={{
      position: "fixed",
      bottom: 20,
      left: 20,
      width: 450,
      background: "rgba(10, 10, 10, 0.95)",
      border: "1px solid #333",
      borderRadius: 12,
      padding: 16,
      color: "#e5e5e5",
      fontFamily: "monospace",
      fontSize: "12px",
      zIndex: 9999,
      backdropFilter: "blur(10px)"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #333", paddingBottom: 10, marginBottom: 10 }}>
        <strong style={{ color: "#fff" }}>AURA Flight Recorder</strong>
        <span style={{ 
          background: stage === "idle" ? "#444" : "#22c55e",
          color: "#fff", 
          padding: "2px 8px", 
          borderRadius: 4, 
          textTransform: "uppercase",
          fontWeight: "bold"
        }}>
          {stage}
        </span>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ color: "#888" }}>Current Turn: {currentTurnId}</div>
        <div style={{ color: "#888" }}>Turn Latency: <strong style={{ color: totalTurnTime > 2000 ? "#ef4444" : "#eab308" }}>{totalTurnTime.toFixed(0)} ms</strong></div>
      </div>

      <div style={{ maxHeight: 250, overflowY: "auto" }}>
        {currentTurnEvents.map((evt, i) => (
          <div key={i} style={{ 
            display: "grid", 
            gridTemplateColumns: "2fr 1fr", 
            gap: 10, 
            padding: "4px 0",
            borderBottom: "1px solid #222"
          }}>
            <div>
              <span style={{ color: evt.blocking ? "#ef4444" : "#60a5fa" }}>■</span> {evt.event}
              <div style={{ fontSize: "10px", color: "#666" }}>{evt.module} ({evt.thread})</div>
            </div>
            <div style={{ textAlign: "right", color: evt.duration > 300 ? "#eab308" : "#fff" }}>
              {evt.duration.toFixed(1)} ms
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
