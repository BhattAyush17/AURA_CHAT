/**
 * DiagnosticsPage — Non-intrusive observability layer for Aura.
 *
 * This component is entirely isolated from the main chat experience.
 * It does NOT import, modify, or interact with any voice, STT, TTS,
 * LLM, memory, WebSocket, or conversation logic.
 *
 * @module
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import {
  runFullDiagnostics,
  downloadDiagnosticReport,
  type DiagnosticSnapshot,
  type DeviceInfo,
  type MicrophoneInfo,
  type AudioContextInfo,
  type SpeechRecognitionInfo,
  type WebSocketInfo,
  type PlaybackInfo,
  type WakeLockInfo,
  type CompatibilityScore,
} from "./diagnosticsEngine";
import "./diagnostics.css";

// ─── Status Indicator ───────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="diag-dot diag-dot--pending" />;
  return <span className={`diag-dot ${ok ? "diag-dot--pass" : "diag-dot--fail"}`} />;
}

function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  const cls = ok === null ? "diag-badge--pending" : ok ? "diag-badge--pass" : "diag-badge--fail";
  const icon = ok === null ? "⏳" : ok ? "✓" : "✗";
  return (
    <span className={`diag-badge ${cls}`}>
      {icon} {label}
    </span>
  );
}

// ─── Section Card ───────────────────────────────────────────────────

function DiagCard({
  title,
  icon,
  status,
  children,
}: {
  title: string;
  icon: string;
  status: boolean | null;
  children: React.ReactNode;
}) {
  return (
    <div className="diag-card" id={`diag-card-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="diag-card__header">
        <div className="diag-card__title-row">
          <span className="diag-card__icon">{icon}</span>
          <h3 className="diag-card__title">{title}</h3>
        </div>
        <StatusDot ok={status} />
      </div>
      <div className="diag-card__body">{children}</div>
    </div>
  );
}

// ─── Field Row ──────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | number | boolean | null }) {
  let display: string;
  if (value === null || value === undefined) display = "—";
  else if (typeof value === "boolean") display = value ? "Yes" : "No";
  else display = String(value);

  return (
    <div className="diag-field">
      <span className="diag-field__label">{label}</span>
      <span className="diag-field__value">{display}</span>
    </div>
  );
}

// ─── Compatibility Gauge ────────────────────────────────────────────

function CompatibilityGauge({ score }: { score: number }) {
  const color =
    score >= 80 ? "oklch(0.7 0.18 145)" : score >= 50 ? "oklch(0.75 0.15 85)" : "oklch(0.7 0.18 25)";
  const label = score >= 80 ? "Excellent" : score >= 50 ? "Partial" : "Poor";

  return (
    <div className="diag-gauge">
      <div className="diag-gauge__ring">
        <svg viewBox="0 0 120 120" className="diag-gauge__svg">
          <circle cx="60" cy="60" r="52" fill="none" stroke="oklch(0.15 0 0)" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 327} 327`}
            transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dasharray 1s cubic-bezier(0.22,1,0.36,1)" }}
          />
        </svg>
        <div className="diag-gauge__label">
          <span className="diag-gauge__number" style={{ color }}>{score}%</span>
          <span className="diag-gauge__text">{label}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Debug Overlay ──────────────────────────────────────────────────

function DebugOverlay({ snapshot }: { snapshot: DiagnosticSnapshot | null }) {
  if (!snapshot) return null;
  const c = snapshot.compatibility;
  const items = [
    { label: "MIC", ok: c.microphone },
    { label: "AUDIO", ok: c.audioEngine },
    { label: "STT", ok: c.speechRecognition },
    { label: "WS", ok: c.webSocket },
    { label: "PLAY", ok: c.playback },
  ];
  return (
    <div className="diag-overlay">
      {items.map((item) => (
        <span key={item.label} className={`diag-overlay__item ${item.ok ? "diag-overlay__item--ok" : "diag-overlay__item--fail"}`}>
          {item.label} {item.ok ? "✓" : "✗"}
        </span>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export function DiagnosticsPage() {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const runDiag = useCallback(async () => {
    setRunning(true);
    try {
      const result = await runFullDiagnostics();
      setSnapshot(result);
    } catch (err) {
      console.error("[Diagnostics] Fatal error during scan:", err);
    } finally {
      setRunning(false);
    }
  }, []);

  // Auto-run on mount
  useEffect(() => {
    runDiag();
  }, [runDiag]);

  const d = snapshot?.device;
  const m = snapshot?.microphone;
  const a = snapshot?.audio;
  const s = snapshot?.speech;
  const w = snapshot?.websocket;
  const p = snapshot?.playback;
  const wl = snapshot?.wakeLock;
  const c = snapshot?.compatibility;

  return (
    <div className="diag-root">
      {/* Debug overlay */}
      {showOverlay && <DebugOverlay snapshot={snapshot} />}

      {/* Header */}
      <header className="diag-header">
        <div className="diag-header__top">
          <Link to="/" className="diag-back-link" id="diag-back-home">
            ← Back to Aura
          </Link>
          <div style={{ display: "flex", gap: 8 }}>
            <Link to="/diagnostics/runtime" className="diag-overlay-toggle" id="diag-link-runtime">
              Runtime Inspector →
            </Link>
            <button
              className="diag-overlay-toggle"
              onClick={() => setShowOverlay(!showOverlay)}
              id="diag-toggle-overlay"
              title="Toggle debug overlay"
            >
              {showOverlay ? "Hide" : "Show"} Overlay
            </button>
          </div>
        </div>
        <div className="diag-header__brand">
          <div className="diag-header__orb" />
          <h1 className="diag-header__title">Aura Diagnostics</h1>
          <p className="diag-header__subtitle">
            Mobile compatibility & voice pipeline health check
          </p>
        </div>
      </header>

      {/* Compatibility Score */}
      <section className="diag-compat-section">
        {c ? (
          <>
            <CompatibilityGauge score={c.overall} />
            <div className="diag-compat-badges">
              <StatusBadge ok={c.microphone} label="Microphone" />
              <StatusBadge ok={c.speechRecognition} label="Speech Recognition" />
              <StatusBadge ok={c.audioEngine} label="Audio Engine" />
              <StatusBadge ok={c.playback} label="Playback" />
              <StatusBadge ok={c.webSocket} label="WebSocket" />
              <StatusBadge ok={c.wakeLock} label="Wake Lock" />
            </div>
          </>
        ) : (
          <div className="diag-scanning">
            <div className="diag-scanning__spinner" />
            <span>Scanning device capabilities…</span>
          </div>
        )}
      </section>

      {/* Cards Grid */}
      <div className="diag-grid">
        {/* Device */}
        <DiagCard title="Device" icon="📱" status={d ? true : null}>
          {d ? (
            <>
              <Field label="Browser" value={`${d.browser} ${d.browserVersion}`} />
              <Field label="Platform" value={d.platform} />
              <Field label="Mobile" value={d.mobile} />
              <Field label="Screen" value={`${d.screenWidth}×${d.screenHeight} @${d.devicePixelRatio}x`} />
              <Field label="Online" value={d.online} />
              <Field label="CPU Cores" value={d.hardwareConcurrency} />
              <Field label="RAM" value={d.deviceMemory ? `${d.deviceMemory} GB` : "N/A"} />
              <Field label="Language" value={d.language} />
              <Field label="Touch" value={d.touchSupport} />
            </>
          ) : (
            <span className="diag-field__label">Scanning…</span>
          )}
        </DiagCard>

        {/* Microphone */}
        <DiagCard title="Microphone" icon="🎙" status={m ? m.supported && m.stream : null}>
          {m ? (
            <>
              <Field label="API Supported" value={m.supported} />
              <Field label="Permission" value={m.permission} />
              <Field label="Stream Acquired" value={m.stream} />
              <Field label="Sample Rate" value={m.sampleRate ? `${m.sampleRate} Hz` : "N/A"} />
              <Field label="Channels" value={m.channelCount} />
              <Field label="Device" value={m.label || "N/A"} />
              {m.failureReason && <Field label="Error" value={m.failureReason} />}
            </>
          ) : (
            <span className="diag-field__label">Testing…</span>
          )}
        </DiagCard>

        {/* Audio Context */}
        <DiagCard title="Audio Engine" icon="🔊" status={a ? a.available : null}>
          {a ? (
            <>
              <Field label="Available" value={a.available} />
              <Field label="Engine" value={a.engine} />
              <Field label="State" value={a.state} />
              <Field label="Sample Rate" value={a.sampleRate ? `${a.sampleRate} Hz` : "N/A"} />
              <Field label="Max Channels" value={a.maxChannelCount} />
            </>
          ) : (
            <span className="diag-field__label">Detecting…</span>
          )}
        </DiagCard>

        {/* Speech Recognition */}
        <DiagCard title="Speech Recognition" icon="🗣" status={s ? s.supported : null}>
          {s ? (
            <>
              <Field label="Supported" value={s.supported} />
              <Field label="Engine" value={s.engine} />
            </>
          ) : (
            <span className="diag-field__label">Detecting…</span>
          )}
        </DiagCard>

        {/* WebSocket */}
        <DiagCard title="WebSocket" icon="🌐" status={w ? w.connected : null}>
          {w ? (
            <>
              <Field label="Connected" value={w.connected} />
              <Field label="Latency" value={w.latencyMs !== null ? `${w.latencyMs} ms` : "N/A"} />
              {w.failureReason && <Field label="Error" value={w.failureReason} />}
            </>
          ) : (
            <span className="diag-field__label">Testing…</span>
          )}
        </DiagCard>

        {/* Audio Playback */}
        <DiagCard title="Audio Playback" icon="▶" status={p ? p.audioPlayable : null}>
          {p ? (
            <>
              <Field label="Playable" value={p.audioPlayable} />
              {p.failureReason && <Field label="Error" value={p.failureReason} />}
            </>
          ) : (
            <span className="diag-field__label">Testing…</span>
          )}
        </DiagCard>

        {/* Wake Lock */}
        <DiagCard title="Wake Lock" icon="🔒" status={wl ? wl.supported : null}>
          {wl ? (
            <Field label="Supported" value={wl.supported} />
          ) : (
            <span className="diag-field__label">Checking…</span>
          )}
        </DiagCard>
      </div>

      {/* Actions */}
      <footer className="diag-actions">
        <button
          className="diag-btn-primary"
          onClick={runDiag}
          disabled={running}
          id="diag-btn-rescan"
        >
          {running ? (
            <>
              <span className="diag-btn-spinner" /> Scanning…
            </>
          ) : (
            "↻ Re-scan"
          )}
        </button>
        <button
          className="diag-btn-secondary"
          onClick={() => snapshot && downloadDiagnosticReport(snapshot)}
          disabled={!snapshot}
          id="diag-btn-export"
        >
          ↓ Export Diagnostics
        </button>
      </footer>

      {/* Timestamp */}
      {snapshot && (
        <p className="diag-timestamp">
          Last scan: {new Date(snapshot.timestamp).toLocaleString()}
        </p>
      )}
    </div>
  );
}
