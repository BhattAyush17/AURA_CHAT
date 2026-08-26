import React, { useEffect, useState } from "react";
import {
  getConversationTrace,
  getConversationLatencies,
  getConversationFingerprint,
  AuraTraceEvent,
} from "../../core/telemetry";

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
      lastError:
        events.filter((e) => e.event.includes("ERROR") || e.event.includes("FAILED")).pop() || null,
      fingerprint,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    alert("Diagnostics copied to clipboard!");
  };

  const lastEvents = events.slice(-20).reverse();

  // Phase 8.1: the latest Executive decision on conversational identity.
  const lastRegister = [...events].reverse().find((e) => e.event === "EXECUTIVE_REGISTER")
    ?.details as
    | {
        language: string;
        languageConfidence: number;
        languageStability: number;
        languageReasons?: string[];
        languageTransition?: string | null;
        register: string;
        registerConfidence: number;
        registerStability: number;
        registerReasons?: string[];
        registerTransition?: string | null;
        momentumWindow: number;
        relationship: string;
        executiveDecision: string;
      }
    | undefined;

  // Phase 10 (WP7): the flight recorder already carries every decision's
  // trace. Surface the latest one per category with its execution status:
  // Computed → Consumed (prompt/audio) → Observable in conversation.
  const lastDecision = [...events].reverse().find((e) => e.event === "EXECUTIVE_PLAN")?.details as
    | { plan: string; timeMs?: number }
    | undefined;
  const lastMemory = [...events].reverse().find((e) => e.event === "EXECUTIVE_MEMORY")?.details as
    | { policy: string; retrieved: number; enforced: number; topRelevance: string }
    | undefined;
  const lastHesitation = [...events].reverse().find((e) => e.event === "HESITATION_SPOKEN")
    ?.details as { text: string; reason?: string } | undefined;
  const slowDecision = [...events].reverse().find((e) => e.event === "EXECUTIVE_SLOW")?.details as
    | { timeMs?: number }
    | undefined;

  // Phase 11: the canonical interpretation of the latest turn — what
  // happened, what it meant, and what AURA decided because of it.
  const lastUnderstanding = [...events]
    .reverse()
    .find((e) => e.event === "CONVERSATION_UNDERSTANDING")?.details as
    | {
        move: string;
        literal: string;
        goal: string;
        expected: string;
        implicit: string | null;
        state: string;
        confidence: number;
        reasoning?: string[];
        alternatives?: { move: string; p: number }[];
        social?: string[];
        shared?: string[];
        strategy?: string;
      }
    | undefined;

  if (!expanded) {
    return (
      <div
        style={{
          padding: 10,
          background: "#1e1e1e",
          color: "white",
          borderRadius: 8,
          marginTop: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Conversation Telemetry</h3>
          <button onClick={() => setExpanded(true)} style={{ padding: "4px 8px" }}>
            Expand
          </button>
        </div>
      </div>
    );
  }

  const IdentityRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
      <span style={{ color: "#aaa" }}>{label}</span>
      <span style={{ fontFamily: "monospace", textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <div
      style={{ padding: 20, background: "#1e1e1e", color: "white", borderRadius: 8, marginTop: 20 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: 0 }}>Conversation Telemetry (Flight Recorder)</h2>
        <div>
          <button onClick={handleCopy} style={{ padding: "6px 12px", marginRight: 10 }}>
            Copy Diagnostics
          </button>
          <button onClick={() => setExpanded(false)} style={{ padding: "6px 12px" }}>
            Collapse
          </button>
        </div>
      </div>

      {/* ── Phase 8.1: Conversational Identity (Executive-owned) ── */}
      <div style={{ background: "#2d2d2d", padding: 15, borderRadius: 8, marginBottom: 20 }}>
        <h4 style={{ marginTop: 0, marginBottom: 8 }}>
          Conversational Identity{" "}
          <span style={{ color: "#888", fontWeight: 400 }}>
            — Executive decision, not LLM inference
          </span>
        </h4>
        {lastRegister ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
            <div>
              <h5 style={{ margin: "6px 0 4px", color: "#60a5fa" }}>Language</h5>
              <IdentityRow label="Conversation Language" value={lastRegister.language} />
              <IdentityRow
                label="Language Confidence"
                value={lastRegister.languageConfidence.toFixed(2)}
              />
              <IdentityRow
                label="Language Stability"
                value={lastRegister.languageStability.toFixed(2)}
              />
              <IdentityRow
                label="Momentum Window"
                value={`${lastRegister.momentumWindow} / 6 turns`}
              />
              <IdentityRow
                label="Language Transition"
                value={lastRegister.languageTransition ?? "—"}
              />
            </div>
            <div>
              <h5 style={{ margin: "6px 0 4px", color: "#60a5fa" }}>Register</h5>
              <IdentityRow label="Conversation Register" value={lastRegister.register} />
              <IdentityRow
                label="Register Confidence"
                value={lastRegister.registerConfidence.toFixed(2)}
              />
              <IdentityRow
                label="Register Stability"
                value={lastRegister.registerStability.toFixed(2)}
              />
              <IdentityRow label="Relationship Stage" value={lastRegister.relationship} />
              <IdentityRow
                label="Register Transition"
                value={lastRegister.registerTransition ?? "—"}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <h5 style={{ margin: "10px 0 4px", color: "#60a5fa" }}>Confidence Explanation</h5>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  color: "#bbb",
                  lineHeight: 1.5,
                }}
              >
                {[
                  ...(lastRegister.languageReasons ?? []),
                  ...(lastRegister.registerReasons ?? []),
                ].map((r, i) => (
                  <div key={i}>· {r}</div>
                ))}
              </div>
            </div>
            <div
              style={{
                gridColumn: "1 / -1",
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid #444",
              }}
            >
              <IdentityRow
                label="Current Executive Decision"
                value={lastRegister.executiveDecision}
              />
            </div>
          </div>
        ) : (
          <div style={{ color: "#888" }}>
            No Executive decision recorded yet — speak a turn to populate this.
          </div>
        )}
      </div>

      {/* Phase 10 (WP7): per-decision execution status — every decision
          traces from Computed → Consumed → Observable in conversation. */}
      <div
        style={{
          background: "#2d2d2d",
          padding: 15,
          borderRadius: 8,
          marginTop: 12,
          fontFamily: "monospace",
          fontSize: "0.75rem",
          color: "#bbb",
        }}
      >
        <h4 style={{ margin: 0, color: "#60a5fa", fontFamily: "sans-serif" }}>
          Phase 10 — Decision Execution Status
        </h4>
        <div style={{ marginTop: 6, lineHeight: 1.6 }}>
          {lastDecision ? (
            <>
              <div>
                Strategy → Prompt: <span style={{ color: "#4ade80" }}>{lastDecision.plan}</span>{" "}
                <span style={{ color: "#666" }}>(Computed → Consumed → Observable)</span>
              </div>
              <div>
                Executive time:{" "}
                <span style={{ color: slowDecision ? "#f87171" : "#4ade80" }}>
                  {lastDecision.timeMs !== undefined ? `${lastDecision.timeMs}ms` : "--"}
                </span>
                {slowDecision && (
                  <span style={{ color: "#f87171" }}> — exceeded 50ms budget (EXECUTIVE_SLOW)</span>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: "#888" }}>No executive decision this session yet.</div>
          )}
          {lastMemory && (
            <div>
              Memory: policy <span style={{ color: "#4ade80" }}>{lastMemory.policy}</span> →{" "}
              {lastMemory.retrieved} retrieved / {lastMemory.enforced} enforced (top relevance{" "}
              {lastMemory.topRelevance})
            </div>
          )}
          {lastHesitation && (
            <div>
              Hesitation: <span style={{ color: "#eab308" }}>"{lastHesitation.text}"</span>
              {lastHesitation.reason ? ` — ${lastHesitation.reason}` : ""} (audible)
            </div>
          )}
        </div>
      </div>

      {/* Phase 11: the canonical understanding — what happened, what it
          meant, and the strategy it produced. Fully inspectable. */}
      <div
        style={{
          background: "#2d2d2d",
          padding: 15,
          borderRadius: 8,
          marginTop: 12,
          fontFamily: "monospace",
          fontSize: "0.75rem",
          color: "#bbb",
        }}
      >
        <h4 style={{ margin: 0, color: "#60a5fa", fontFamily: "sans-serif" }}>
          Phase 11 — Conversation Understanding
        </h4>
        {lastUnderstanding ? (
          <div style={{ marginTop: 6, lineHeight: 1.6 }}>
            <div>
              Move: <span style={{ color: "#4ade80" }}>{lastUnderstanding.move}</span>
              <span style={{ color: "#666" }}>
                {" "}
                (literal: {lastUnderstanding.literal}, conf{" "}
                {lastUnderstanding.confidence.toFixed(2)})
              </span>
            </div>
            <div>
              Goal: <span style={{ color: "#4ade80" }}>{lastUnderstanding.goal}</span> → expects{" "}
              <span style={{ color: "#4ade80" }}>{lastUnderstanding.expected}</span>
              {lastUnderstanding.implicit && (
                <>
                  {" "}
                  | implicit: <span style={{ color: "#eab308" }}>{lastUnderstanding.implicit}</span>
                </>
              )}
            </div>
            <div>
              State: <span style={{ color: "#4ade80" }}>{lastUnderstanding.state}</span>
              {lastUnderstanding.social && lastUnderstanding.social.length > 0 && (
                <>
                  {" "}
                  | signals:{" "}
                  <span style={{ color: "#eab308" }}>{lastUnderstanding.social.join(", ")}</span>
                </>
              )}
            </div>
            {lastUnderstanding.reasoning && lastUnderstanding.reasoning.length > 0 && (
              <div style={{ color: "#888" }}>why: {lastUnderstanding.reasoning.join("; ")}</div>
            )}
            {lastUnderstanding.alternatives && lastUnderstanding.alternatives.length > 0 && (
              <div style={{ color: "#888" }}>
                alternatives:{" "}
                {lastUnderstanding.alternatives
                  .map((a) => `${a.move} ${(a.p * 100).toFixed(0)}%`)
                  .join(", ")}
              </div>
            )}
            <div>
              Executive strategy:{" "}
              <span style={{ color: "#4ade80" }}>{lastUnderstanding.strategy ?? "—"}</span>
              {lastUnderstanding.shared && lastUnderstanding.shared.length > 0 && (
                <span style={{ color: "#888" }}> — {lastUnderstanding.shared.join("; ")}</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 6, color: "#888" }}>
            No understanding recorded yet — speak a turn to populate this.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        <div style={{ flex: 1, background: "#2d2d2d", padding: 15, borderRadius: 8 }}>
          <h4 style={{ marginTop: 0 }}>Current Stage / Fingerprint</h4>
          <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4ade80" }}>
            {fingerprint}
          </div>

          <h4 style={{ marginTop: 20 }}>Latency Breakdown</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontFamily: "monospace" }}>
            <li>Mic → Transcript: {latencies.sttLatency ? `${latencies.sttLatency}ms` : "--"}</li>
            <li>
              Transcript → LLM First Token:{" "}
              {latencies.llmLatency ? `${latencies.llmLatency}ms` : "--"}
            </li>
            <li>LLM → TTS Ready: {latencies.ttsLatency ? `${latencies.ttsLatency}ms` : "--"}</li>
            <li>
              TTS Ready → Playback Start:{" "}
              {latencies.playbackLatency ? `${latencies.playbackLatency}ms` : "--"}
            </li>
            <li>
              Playback Duration:{" "}
              {latencies.playbackDuration ? `${latencies.playbackDuration}ms` : "--"}
            </li>
            <li style={{ borderTop: "1px solid #444", marginTop: 5, paddingTop: 5 }}>
              Total Turn Time (Mic → Playback):{" "}
              {latencies.totalTurnLatency ? `${latencies.totalTurnLatency}ms` : "--"}
            </li>
          </ul>
        </div>

        <div
          style={{
            flex: 2,
            background: "#2d2d2d",
            padding: 15,
            borderRadius: 8,
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
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
                  <td style={{ padding: "4px 0", color: "#888" }}>
                    {new Date(e.timestamp).toISOString().split("T")[1].replace("Z", "")}
                  </td>
                  <td
                    style={{
                      padding: "4px 0",
                      color:
                        e.event.includes("ERROR") || e.event.includes("FAILED")
                          ? "#ef4444"
                          : "#60a5fa",
                    }}
                  >
                    {e.event}
                  </td>
                  <td style={{ padding: "4px 0", fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {e.details ? JSON.stringify(e.details) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
