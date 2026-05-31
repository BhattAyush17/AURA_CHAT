/**
 * RuntimeDiagnosticsPage — Production voice pipeline inspector.
 *
 * Observes the real Aura runtime pipeline and identifies failure points.
 * Completely isolated — does NOT import or modify any production code.
 *
 * @module
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  runtimeTrace,
  type TraceEvent,
  type PipelineStatus,
  type FailureFingerprint,
  type LatencyBreakdown,
} from "./runtimeTraceEngine";
import { runSttStressTest, type StressTestResult } from "./sttStressTest";
import {
  runFullMobileLifecycleTests,
  type MobileLifecycleReport,
} from "./mobileLifecycleTests";
import { SpeechRecognitionProbe, type ProbeResult } from "./speechRecognitionProbe";
import "./runtimeDiagnostics.css";

// ─── Health Item ────────────────────────────────────────────────────

function HealthItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="rtd-health__item">
      <div className={`rtd-health__dot rtd-health__dot--${status}`} />
      <span className="rtd-health__label">{label}</span>
      <span className="rtd-health__status">{status}</span>
    </div>
  );
}

// ─── Latency Card ───────────────────────────────────────────────────

function LatencyCard({ label, value }: { label: string; value: number | null }) {
  const empty = value === null;
  return (
    <div className={`rtd-latency-card ${empty ? "rtd-latency-card--empty" : ""}`}>
      <div className="rtd-latency-card__label">{label}</div>
      <div className="rtd-latency-card__value">
        {empty ? "—" : value}
        {!empty && <span className="rtd-latency-card__unit">ms</span>}
      </div>
    </div>
  );
}

// ─── Fingerprint Row ────────────────────────────────────────────────

function FingerprintRow({ fp }: { fp: FailureFingerprint }) {
  return (
    <div className="rtd-fingerprint">
      <div className="rtd-fingerprint__confidence">{fp.confidence}%</div>
      <div className="rtd-fingerprint__info">
        <div className="rtd-fingerprint__cause">{fp.rootCause}</div>
        <div className="rtd-fingerprint__suggestion">{fp.suggestion}</div>
      </div>
      <div className="rtd-fingerprint__time">
        {new Date(fp.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

// ─── Timeline Row ───────────────────────────────────────────────────

function TimelineRow({ event, isNew }: { event: TraceEvent; isNew: boolean }) {
  return (
    <div className={`rtd-timeline-row ${isNew ? "rtd-timeline-row--new" : ""}`}>
      <span className={`rtd-timeline__dot rtd-timeline__dot--${event.status}`} />
      <span className="rtd-timeline__time">
        {new Date(event.timestamp).toLocaleTimeString()}
      </span>
      <span className="rtd-timeline__stage">{event.stage}</span>
      <span className="rtd-timeline__details">{event.details || event.error || ""}</span>
      <span className="rtd-timeline__dur">
        {event.durationMs !== null ? `${event.durationMs}ms` : ""}
      </span>
    </div>
  );
}

// ─── Test Card ──────────────────────────────────────────────────────

function TestField({ label, value }: { label: string; value: string | number | boolean | null }) {
  let display: string;
  if (value === null || value === undefined) display = "—";
  else if (typeof value === "boolean") display = value ? "Yes" : "No";
  else display = String(value);
  return (
    <div className="rtd-test-card__field">
      <span className="rtd-test-card__field-label">{label}</span>
      <span className="rtd-test-card__field-value">{display}</span>
    </div>
  );
}

// ─── Speech Probe Card ────────────────────────────────────────────────

function SpeechProbeCard({ probe, result }: { probe: SpeechRecognitionProbe; result: ProbeResult }) {

  return (
    <div className="rtd-test-card" id="rtd-speech-probe">
      <div className="rtd-test-card__header">
        <span className="rtd-test-card__title">Speech Recognition Probe</span>
        {result.diagnosis && (
          <span
            className={`rtd-test-card__status ${
              result.success ? "rtd-test-card__status--pass" : "rtd-test-card__status--fail"
            }`}
          >
            {result.success ? "PASS" : "FAIL"}
          </span>
        )}
      </div>
      <div className="rtd-test-card__body">
        <div className="rtd-probe-pipeline">
          {(() => {
            const stages: string[] = ["START", "AUDIO_START", "SOUND_START", "SPEECH_DETECTED", "RESULT"];
            if (result.stages.ERROR !== "pending" && result.stages.ERROR !== "skipped") {
              stages.push("ERROR");
            } else {
              stages.push("END");
            }
            return stages.map((stage, i, arr) => {
              const status = result.stages[stage as keyof typeof result.stages];
              return (
                <div key={stage} className="rtd-probe-stage-wrapper">
                  <div className="rtd-probe-stage">
                    <span className="rtd-probe-stage__label">{stage}</span>
                    <span className={`rtd-probe-stage__status rtd-probe-stage__status--${status}`}>
                      {status === "pass" ? "✓" : status === "fail" ? "✗" : "PENDING"}
                    </span>
                  </div>
                  {i < arr.length - 1 && <div className="rtd-probe-arrow">↓</div>}
                </div>
              );
            });
          })()}
        </div>

        {result.transcript && (
          <div className="rtd-probe-transcript">
            <div className="rtd-probe-transcript__label">Detected Transcript</div>
            <div className="rtd-probe-transcript__text">{result.transcript}</div>
            <div className="rtd-probe-transcript__conf">Confidence: {result.confidence}</div>
          </div>
        )}

        {result.diagnosis && (
          <div className="rtd-probe-diagnosis">
            <div className="rtd-probe-diagnosis__label">Diagnosis</div>
            <div className="rtd-probe-diagnosis__text">{result.diagnosis}</div>
          </div>
        )}

        <div className="rtd-probe-actions">
          <button
            className="rtd-btn rtd-btn--secondary"
            onClick={() => probe.start()}
            disabled={result.running}
          >
            {result.running ? (
              <><span className="rtd-btn-spinner" /> Listening…</>
            ) : (
              "Start Probe"
            )}
          </button>
          <button
            className="rtd-btn rtd-btn--secondary"
            onClick={() => probe.downloadReport()}
            disabled={result.events.length === 0}
          >
            Export Probe Report
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export function RuntimeDiagnosticsPage() {
  const [events, setEvents] = useState<TraceEvent[]>(runtimeTrace.getEvents());
  const [health, setHealth] = useState<PipelineStatus>(runtimeTrace.getHealth());
  const [latency, setLatency] = useState<LatencyBreakdown>(runtimeTrace.computeLatency());
  const [fingerprints, setFingerprints] = useState<FailureFingerprint[]>(runtimeTrace.getFingerprints());
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());

  // Global Speech Probe
  const [speechProbe] = useState(() => new SpeechRecognitionProbe());
  const [speechProbeResult, setSpeechProbeResult] = useState<ProbeResult>(speechProbe.getResult());

  // Test states
  const [sttTestRunning, setSttTestRunning] = useState(false);
  const [sttTestResult, setSttTestResult] = useState<StressTestResult | null>(null);
  const [mobileTestRunning, setMobileTestRunning] = useState(false);
  const [mobileTestResult, setMobileTestResult] = useState<MobileLifecycleReport | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);

  // Subscribe to real-time events
  useEffect(() => {
    runtimeTrace.startPassiveMonitors();

    const unsub = runtimeTrace.subscribe((event) => {
      setEvents(runtimeTrace.getEvents());
      setHealth(runtimeTrace.getHealth());
      setLatency(runtimeTrace.computeLatency());
      setFingerprints(runtimeTrace.getFingerprints());

      // Mark as new for animation
      setNewEventIds((prev) => {
        const next = new Set(prev);
        next.add(event.id);
        return next;
      });

      // Remove "new" status after animation completes
      setTimeout(() => {
        setNewEventIds((prev) => {
          const next = new Set(prev);
          next.delete(event.id);
          return next;
        });
      }, 600);

      // Auto-scroll timeline
      if (timelineRef.current) {
        timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
      }
    });

    const unsubProbe = speechProbe.subscribe(setSpeechProbeResult);

    return () => {
      unsub();
      unsubProbe();
      runtimeTrace.stopPassiveMonitors();
    };
  }, [speechProbe]);

  // ─── STT Stress Test ───────────────────────────────────────────

  const handleSttStressTest = useCallback(async () => {
    setSttTestRunning(true);
    setSttTestResult(null);
    try {
      const result = await runSttStressTest(30);
      setSttTestResult(result);
    } catch (err) {
      console.error("[Runtime Diag] STT stress test crashed:", err);
    } finally {
      setSttTestRunning(false);
    }
  }, []);

  // ─── Mobile Lifecycle Tests ───────────────────────────────────

  const handleMobileTests = useCallback(async () => {
    setMobileTestRunning(true);
    setMobileTestResult(null);
    try {
      const result = await runFullMobileLifecycleTests();
      setMobileTestResult(result);
    } catch (err) {
      console.error("[Runtime Diag] Mobile lifecycle tests crashed:", err);
    } finally {
      setMobileTestRunning(false);
    }
  }, []);

  // ─── Actions ──────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    runtimeTrace.downloadReport();
  }, []);

  const handleClear = useCallback(() => {
    runtimeTrace.clear();
    setEvents([]);
    setHealth(runtimeTrace.getHealth());
    setLatency(runtimeTrace.computeLatency());
    setFingerprints([]);
  }, []);

  // Inject a test event for demonstration
  const handleInjectTest = useCallback(() => {
    runtimeTrace.emit("MIC_BUTTON_CLICK", "ok", "User tapped mic button");
    runtimeTrace.emit("MIC_PERMISSION_CHECK", "ok", "Permission granted");
    runtimeTrace.emit("MIC_STREAM_ACQUIRED", "ok", "Stream active", null, 120);
    runtimeTrace.emit("STT_STARTED", "ok", "SpeechRecognition started");
    setTimeout(() => {
      runtimeTrace.emit("STT_PARTIAL_RESULT", "info", "Hello...");
      runtimeTrace.emit("STT_FINAL_RESULT", "ok", "Hello, how are you?", null, 1200);
      runtimeTrace.emit("LLM_REQUEST_START", "ok", "Sending to OpenRouter");
      setTimeout(() => {
        runtimeTrace.emit("LLM_REQUEST_SUCCESS", "ok", "Response received", null, 1400);
        runtimeTrace.emit("TTS_REQUEST_START", "ok", "Generating speech");
        setTimeout(() => {
          runtimeTrace.emit("TTS_REQUEST_SUCCESS", "ok", "Audio ready", null, 450);
          runtimeTrace.emit("AUDIO_PLAYBACK_START", "ok", "Playing audio");
          setTimeout(() => {
            runtimeTrace.emit("AUDIO_PLAYBACK_END", "ok", "Playback complete", null, 3200);
          }, 500);
        }, 300);
      }, 400);
    }, 300);
  }, []);

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="rtd-root">
      {/* Header */}
      <header className="rtd-header">
        <div className="rtd-header__nav">
          <Link to="/" className="rtd-nav-link" id="rtd-back-home">← Home</Link>
          <Link to="/diagnostics" className="rtd-nav-link" id="rtd-back-diag">
            ← Device Diagnostics
          </Link>
        </div>
        <div className="rtd-header__brand">
          <div className="rtd-header__orb" />
          <h1 className="rtd-header__title">Runtime Pipeline Inspector</h1>
          <p className="rtd-header__subtitle">
            Real-time voice pipeline trace & failure detection
          </p>
        </div>
      </header>

      {/* ── Health Dashboard ──────────────────────────────────── */}
      <section className="rtd-health" id="rtd-health-dashboard">
        <HealthItem label="MIC" status={health.mic} />
        <HealthItem label="STT" status={health.stt} />
        <HealthItem label="VAD" status={health.vad} />
        <HealthItem label="WS" status={health.ws} />
        <HealthItem label="LLM" status={health.llm} />
        <HealthItem label="TTS" status={health.tts} />
        <HealthItem label="PLAY" status={health.playback} />
      </section>

      {/* ── Latency Breakdown ─────────────────────────────────── */}
      <section className="rtd-section">
        <h2 className="rtd-section__title">
          <span className="rtd-section__icon">⏱</span> Latency Breakdown
        </h2>
        <div className="rtd-latency-grid">
          <LatencyCard label="Mic → STT" value={latency.micToStt} />
          <LatencyCard label="STT → Transcript" value={latency.sttToTranscript} />
          <LatencyCard label="Transcript → LLM" value={latency.transcriptToLlm} />
          <LatencyCard label="LLM → TTS" value={latency.llmToTts} />
          <LatencyCard label="TTS → Playback" value={latency.ttsToPlayback} />
          <LatencyCard label="Total" value={latency.totalLatency} />
        </div>
      </section>

      {/* ── Failure Fingerprints ───────────────────────────────── */}
      <section className="rtd-section">
        <h2 className="rtd-section__title">
          <span className="rtd-section__icon">🔍</span> Failure Fingerprints
        </h2>
        {fingerprints.length > 0 ? (
          <div className="rtd-fingerprints">
            {fingerprints.slice(-10).reverse().map((fp, i) => (
              <FingerprintRow key={i} fp={fp} />
            ))}
          </div>
        ) : (
          <div className="rtd-empty-state">No failures detected — pipeline healthy</div>
        )}
      </section>

      {/* ── Event Timeline ────────────────────────────────────── */}
      <section className="rtd-section">
        <h2 className="rtd-section__title">
          <span className="rtd-section__icon">📋</span> Event Timeline
        </h2>
        <div className="rtd-timeline" ref={timelineRef} id="rtd-event-timeline">
          {events.length > 0 ? (
            events.slice(-100).map((event) => (
              <TimelineRow
                key={event.id}
                event={event}
                isNew={newEventIds.has(event.id)}
              />
            ))
          ) : (
            <div className="rtd-empty-state" style={{ borderRadius: 0, border: "none" }}>
              No events recorded. Use Aura or inject test events.
            </div>
          )}
        </div>
        {events.length > 0 && (
          <div className="rtd-timeline__count">{events.length} / 500 events</div>
        )}
      </section>

      {/* ── Tests ─────────────────────────────────────────────── */}
      <section className="rtd-section">
        <h2 className="rtd-section__title">
          <span className="rtd-section__icon">🧪</span> Stress Tests
        </h2>

        <div className="rtd-tests-grid">
          {/* Speech Probe */}
          <SpeechProbeCard probe={speechProbe} result={speechProbeResult} />

          {/* STT Stress Test */}
          <div className="rtd-test-card" id="rtd-stt-stress-test">
            <div className="rtd-test-card__header">
              <span className="rtd-test-card__title">STT Stress Test</span>
              {sttTestResult && (
                <span
                  className={`rtd-test-card__status ${
                    sttTestResult.failures === 0
                      ? "rtd-test-card__status--pass"
                      : "rtd-test-card__status--fail"
                  }`}
                >
                  {sttTestResult.failures === 0 ? "PASS" : "FAIL"}
                </span>
              )}
            </div>
            <div className="rtd-test-card__body">
              {sttTestResult ? (
                <>
                  <TestField label="Attempts" value={sttTestResult.attempts} />
                  <TestField label="Success" value={sttTestResult.success} />
                  <TestField label="Failures" value={sttTestResult.failures} />
                  <TestField label="Total Time" value={`${sttTestResult.durationMs}ms`} />
                  <TestField label="Avg Cycle" value={`${sttTestResult.avgCycleMs}ms`} />
                  {sttTestResult.failureReasons.length > 0 && (
                    <div className="rtd-test-card__details">
                      {sttTestResult.failureReasons.slice(0, 5).join("\n")}
                    </div>
                  )}
                </>
              ) : (
                <div className="rtd-test-card__details">
                  Runs 30 consecutive start/stop cycles on an independent SpeechRecognition instance.
                </div>
              )}
              <button
                className="rtd-btn rtd-btn--secondary"
                onClick={handleSttStressTest}
                disabled={sttTestRunning}
                id="rtd-btn-stt-stress"
                style={{ marginTop: 8 }}
              >
                {sttTestRunning ? (
                  <><span className="rtd-btn-spinner" /> Running…</>
                ) : (
                  "Run STT Stress Test"
                )}
              </button>
            </div>
          </div>

          {/* Mobile Lifecycle Tests */}
          <div className="rtd-test-card" id="rtd-mobile-lifecycle-tests">
            <div className="rtd-test-card__header">
              <span className="rtd-test-card__title">Mobile Lifecycle</span>
              {mobileTestResult && (
                <span
                  className={`rtd-test-card__status ${
                    mobileTestResult.backgroundRecovery.audioContextRestored &&
                    mobileTestResult.screenLockRecovery.sessionRecovered
                      ? "rtd-test-card__status--pass"
                      : "rtd-test-card__status--fail"
                  }`}
                >
                  {mobileTestResult.backgroundRecovery.audioContextRestored &&
                  mobileTestResult.screenLockRecovery.sessionRecovered
                    ? "PASS"
                    : "FAIL"}
                </span>
              )}
            </div>
            <div className="rtd-test-card__body">
              {mobileTestResult ? (
                <>
                  <TestField label="Audio Restored" value={mobileTestResult.backgroundRecovery.audioContextRestored} />
                  <TestField label="STT Recovered" value={mobileTestResult.backgroundRecovery.sttRecovered} />
                  <TestField label="Session Recovered" value={mobileTestResult.screenLockRecovery.sessionRecovered} />
                  <TestField label="Socket Recovered" value={mobileTestResult.networkSwitch.socketRecovered} />
                  <TestField label="Recovery Time" value={
                    mobileTestResult.networkSwitch.recoveryTimeMs > 0
                      ? `${mobileTestResult.networkSwitch.recoveryTimeMs}ms`
                      : "N/A"
                  } />
                </>
              ) : (
                <div className="rtd-test-card__details">
                  Tests background recovery, screen lock recovery, and network switching.
                </div>
              )}
              <button
                className="rtd-btn rtd-btn--secondary"
                onClick={handleMobileTests}
                disabled={mobileTestRunning}
                id="rtd-btn-mobile-lifecycle"
                style={{ marginTop: 8 }}
              >
                {mobileTestRunning ? (
                  <><span className="rtd-btn-spinner" /> Testing…</>
                ) : (
                  "Run Mobile Lifecycle Tests"
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Actions ───────────────────────────────────────────── */}
      <div className="rtd-actions">
        <button 
          className="rtd-btn rtd-btn--primary" 
          onClick={() => {
            document.getElementById("rtd-speech-probe")?.scrollIntoView({ behavior: "smooth", block: "center" });
            speechProbe.start();
          }} 
          disabled={speechProbeResult.running}
          id="rtd-btn-global-probe"
          style={{ background: "oklch(0.7 0.18 145)", color: "oklch(0.05 0 0)", border: "none", fontSize: "0.9rem" }}
        >
          {speechProbeResult.running ? (
            <><span className="rtd-btn-spinner" style={{ borderColor: "oklch(0.05 0 0)", borderTopColor: "transparent" }} /> Listening…</>
          ) : (
            "🎙 Start Speech Probe"
          )}
        </button>
        <button className="rtd-btn rtd-btn--secondary" onClick={handleInjectTest} id="rtd-btn-inject">
          ⚡ Inject Test Events
        </button>
        <button className="rtd-btn rtd-btn--primary" onClick={handleExport} disabled={events.length === 0} id="rtd-btn-export">
          ↓ Export Runtime Report
        </button>
        <button className="rtd-btn rtd-btn--danger" onClick={handleClear} disabled={events.length === 0} id="rtd-btn-clear">
          ✕ Clear Events
        </button>
      </div>

      {/* Timestamp */}
      <p className="rtd-timestamp">
        Trace engine active — {events.length} events captured
      </p>
    </div>
  );
}
