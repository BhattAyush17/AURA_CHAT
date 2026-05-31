import React, { useEffect, useState } from "react";
import { getConversationTrace, getConversationLatencies, getConversationFingerprint, AuraTraceEvent } from "../../core/telemetry";

export const ConversationTelemetryPanel: React.FC = () => {
  const [events, setEvents] = useState<AuraTraceEvent[]>([]);
  const [latencies, setLatencies] = useState<any>({});
  const [fingerprint, setFingerprint] = useState<string>("Running / Unknown");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setEvents([...getConversationTrace()]);
      setLatencies(getConversationLatencies());
      setFingerprint(getConversationFingerprint());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleCopy = () => {
    const data = {
      events,
      latencies,
      lastError: events.filter(e => e.event.includes("ERROR") || e.event.includes("FAILED")).pop() || null,
      fingerprint
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    alert("Diagnostics copied to clipboard!");
  };

  const lastEvents = events.slice(-20).reverse();

  if (!expanded) {
    return (
      <div style={{ padding: 10, background: "#1e1e1e", color: "white", borderRadius: 8, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Conversation Telemetry</h3>
          <button onClick={() => setExpanded(true)} style={{ padding: "4px 8px" }}>Expand</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, background: "#1e1e1e", color: "white", borderRadius: 8, marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Conversation Telemetry (Flight Recorder)</h2>
        <div>
          <button onClick={handleCopy} style={{ padding: "6px 12px", marginRight: 10 }}>Copy Diagnostics</button>
          <button onClick={() => setExpanded(false)} style={{ padding: "6px 12px" }}>Collapse</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        <div style={{ flex: 1, background: "#2d2d2d", padding: 15, borderRadius: 8 }}>
          <h4 style={{ marginTop: 0 }}>Current Stage / Fingerprint</h4>
          <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4ade80" }}>{fingerprint}</div>
          
          <h4 style={{ marginTop: 20 }}>Latency Breakdown</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontFamily: "monospace" }}>
            <li>Mic → Transcript: {latencies.sttLatency ? `${latencies.sttLatency}ms` : "--"}</li>
            <li>Transcript → LLM First Token: {latencies.llmLatency ? `${latencies.llmLatency}ms` : "--"}</li>
            <li>LLM → TTS Ready: {latencies.ttsLatency ? `${latencies.ttsLatency}ms` : "--"}</li>
            <li>TTS Ready → Playback Start: {latencies.playbackLatency ? `${latencies.playbackLatency}ms` : "--"}</li>
            <li>Playback Duration: {latencies.playbackDuration ? `${latencies.playbackDuration}ms` : "--"}</li>
            <li style={{ borderTop: "1px solid #444", marginTop: 5, paddingTop: 5 }}>Total Turn Time (Mic → Playback): {latencies.totalTurnLatency ? `${latencies.totalTurnLatency}ms` : "--"}</li>
          </ul>
        </div>

        <div style={{ flex: 2, background: "#2d2d2d", padding: 15, borderRadius: 8, maxHeight: 400, overflowY: "auto" }}>
          <h4 style={{ marginTop: 0 }}>Last 20 Events</h4>
          <table style={{ width: "100%", fontSize: "0.85rem", textAlign: "left" }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {lastEvents.map((e, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #444" }}>
                  <td style={{ padding: "4px 0", color: "#888" }}>{new Date(e.timestamp).toISOString().split("T")[1].replace("Z", "")}</td>
                  <td style={{ padding: "4px 0", color: e.event.includes("ERROR") || e.event.includes("FAILED") ? "#ef4444" : "#60a5fa" }}>{e.event}</td>
                  <td style={{ padding: "4px 0", fontFamily: "monospace", fontSize: "0.75rem" }}>{e.details ? JSON.stringify(e.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
