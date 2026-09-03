/**
 * MobileMusicPipelineSection — forensic observability for the
 * HTMLAudioElement → AudioContext → MediaElementAudioSourceNode → AnalyserNode
 * → DSP loop → MusicPerceptionOrchestrator → MusicalEvidenceFusion pipeline.
 *
 * This is a read-only renderer. It subscribes to `auraTelemetry` and never
 * triggers playback, LLM, embedding, or Supabase calls. Page-visibility
 * listeners are installed for diagnostics only and do not modify playback
 * semantics.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Smartphone,
  ListChecks,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { DiagnosticSection } from "./DiagnosticSection";
import {
  auraTelemetry,
  type MobileMusicPipelineState,
  type MobileMusicTimelineEntry,
  type TelemetrySnapshot,
} from "@/telemetry";

type Health =
  | "active"
  | "degraded"
  | "failed"
  | "not_initialized"
  | "suspended"
  | "reused"
  | "stalled"
  | "not_running"
  | "zero"
  | "inactive"
  | "waiting"
  | "available";

const HEALTH_GLYPH: Record<string, string> = {
  active: "✓",
  available: "✓",
  reused: "↻",
  suspended: "⚠",
  degraded: "⚠",
  stalled: "⚠",
  zero: "✕",
  failed: "✕",
  inactive: "—",
  waiting: "—",
  not_initialized: "—",
  not_running: "—",
};

function healthClass(h: string | undefined): string {
  switch (h) {
    case "active":
    case "available":
    case "reused":
      return "text-emerald-400";
    case "suspended":
    case "degraded":
    case "stalled":
      return "text-amber-400";
    case "failed":
    case "zero":
      return "text-red-400";
    default:
      return "text-muted-foreground/60";
  }
}

function fmtTime(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const d = new Date(ts);
  return (
    d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function fmtAgo(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 1) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function timelineLabel(t: MobileMusicTimelineEntry): string {
  const map: Record<string, string> = {
    user_gesture: "User gesture",
    play_requested: "audio.play() requested",
    play_resolved: "audio.play() resolved",
    play_rejected: "audio.play() rejected",
    playing: "playing event",
    pause: "pause event",
    waiting: "waiting event",
    stalled: "stalled event",
    canplay: "canplay event",
    loadedmetadata: "loadedmetadata",
    error: "error event",
    ended: "ended event",
    seeking: "seeking",
    seeked: "seeked",
    audio_context_created: "AudioContext created",
    audio_context_resume_requested: "AudioContext.resume() requested",
    audio_context_resume_resolved: "AudioContext.resume() resolved",
    audio_context_resume_rejected: "AudioContext.resume() rejected",
    audio_context_state_running: "AudioContext → running",
    audio_context_state_suspended: "AudioContext → suspended",
    audio_context_state_closed: "AudioContext → closed",
    media_element_source_created: "MediaElementAudioSourceNode created",
    media_element_source_reused: "MediaElementAudioSourceNode reused",
    media_element_source_failed: "MediaElementAudioSourceNode failed",
    analyser_created: "AnalyserNode created",
    dsp_loop_started: "DSP loop started",
    dsp_loop_stopped: "DSP loop stopped",
    dsp_zero_signal_frame: "DSP → zero signal frame",
    dsp_signal_recovered: "DSP signal recovered",
    visibility_hidden: "document hidden",
    visibility_visible: "document visible",
    page_hide: "pagehide",
    page_show: "pageshow",
  };
  return map[t.kind] || t.kind;
}

function healthLabel(h: string | undefined): string {
  switch (h) {
    case "active":
      return "ACTIVE";
    case "available":
      return "AVAILABLE";
    case "reused":
      return "REUSED";
    case "suspended":
      return "SUSPENDED";
    case "degraded":
      return "DEGRADED";
    case "stalled":
      return "STALLED";
    case "zero":
      return "ZERO SIGNAL";
    case "failed":
      return "FAILED";
    case "inactive":
      return "INACTIVE";
    case "waiting":
      return "WAITING";
    case "not_initialized":
      return "NOT INITIALIZED";
    case "not_running":
      return "NOT RUNNING";
    default:
      return (h || "—").toUpperCase();
  }
}

function statusRow(label: string, value: string, klass: string): React.ReactNode {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/15">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className={`text-[11px] font-mono font-semibold ${klass}`}>{value}</span>
    </div>
  );
}

function HealthRow({ label, value }: { label: string; value: string | undefined }) {
  return statusRow(label, healthLabel(value), healthClass(value));
}

export function MobileMusicPipelineSection() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(auraTelemetry.getSnapshot());
  useEffect(() => auraTelemetry.subscribe(setSnapshot), []);

  const s: MobileMusicPipelineState = snapshot.mobileMusicPipeline;

  // Page-visibility + page lifecycle listeners (read-only).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => {
      auraTelemetry.updateMobileMusicVisibility({
        state: document.visibilityState === "hidden" ? "hidden" : "visible",
        hidden: document.hidden,
      });
    };
    sync();
    const onVis = () => {
      auraTelemetry.recordMobileMusicTimeline(
        document.visibilityState === "hidden" ? "visibility_hidden" : "visibility_visible",
      );
      sync();
    };
    const onHide = () => auraTelemetry.recordMobileMusicTimeline("page_hide");
    const onShow = () => auraTelemetry.recordMobileMusicTimeline("page_show");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  const lastDspFrame = s.dspLoop.lastFrame;
  const timeline = useMemo(() => [...s.timeline].reverse(), [s.timeline]);

  return (
    <DiagnosticSection
      title="Mobile Music Pipeline"
      icon={Smartphone}
      badge={`${s.env.browserClass}${s.diagnosis === "PIPELINE_ACTIVE" ? " · ACTIVE" : ""}`}
    >
      <div className="space-y-3 font-mono text-[11px]">
        {/* 1. Environment */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Environment
          </div>
          {statusRow(
            "Browser class",
            s.env.browserClass,
            s.env.isIOS || s.env.isAndroid ? "text-amber-400" : "text-foreground",
          )}
          {statusRow(
            "Mobile",
            s.env.isMobile ? "YES" : "no",
            s.env.isMobile ? "text-amber-400" : "text-muted-foreground",
          )}
          {statusRow(
            "AudioContext API",
            s.env.webAudio.audioContext ? "available" : "missing",
            s.env.webAudio.audioContext ? "text-emerald-400" : "text-red-400",
          )}
          {statusRow(
            "OfflineAudioContext",
            s.env.webAudio.offlineAudioContext ? "available" : "missing",
            s.env.webAudio.offlineAudioContext ? "text-emerald-400" : "text-red-400",
          )}
          {statusRow(
            "AnalyserNode",
            s.env.webAudio.analyserNode ? "available" : "missing",
            s.env.webAudio.analyserNode ? "text-emerald-400" : "text-red-400",
          )}
          {s.env.viewport &&
            statusRow("Viewport", `${s.env.viewport.w}×${s.env.viewport.h}`, "text-foreground")}
        </div>

        {/* 2. Audio Element / Source */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Audio Element
          </div>
          {statusRow(
            "Present",
            s.audioElement.present ? "yes" : "no",
            s.audioElement.present ? "text-emerald-400" : "text-muted-foreground",
          )}
          {s.audioElement.present && (
            <>
              {statusRow(
                "paused",
                s.audioElement.paused === null ? "—" : String(s.audioElement.paused),
                s.audioElement.paused === false
                  ? "text-emerald-400"
                  : s.audioElement.paused === true
                    ? "text-amber-400"
                    : "text-muted-foreground",
              )}
              {statusRow(
                "currentTime",
                s.audioElement.currentTime == null
                  ? "—"
                  : `${s.audioElement.currentTime.toFixed(2)}s`,
                "text-foreground",
              )}
              {statusRow(
                "duration",
                s.audioElement.duration == null ? "—" : `${s.audioElement.duration.toFixed(2)}s`,
                "text-foreground",
              )}
              {statusRow(
                "readyState",
                s.audioElement.readyState == null ? "—" : String(s.audioElement.readyState),
                "text-foreground",
              )}
              {statusRow(
                "crossOrigin",
                s.audioElement.crossOrigin ?? "—",
                s.audioElement.crossOrigin === "anonymous" ? "text-amber-400" : "text-foreground",
              )}
              {statusRow(
                "source class",
                s.audioElement.sourceClass,
                s.audioElement.sourceClass === "proxy"
                  ? "text-emerald-400"
                  : s.audioElement.sourceClass === "direct"
                    ? "text-amber-400"
                    : "text-foreground",
              )}
            </>
          )}
        </div>

        {/* 3. AudioContext */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            AudioContext
          </div>
          {statusRow(
            "lifecycle",
            s.audioContext.lifecycle.toUpperCase(),
            s.audioContext.lifecycle === "running"
              ? "text-emerald-400"
              : s.audioContext.lifecycle === "suspended"
                ? "text-amber-400"
                : s.audioContext.lifecycle === "closed" || s.audioContext.lifecycle === "absent"
                  ? "text-red-400"
                  : "text-foreground",
          )}
          {statusRow(
            "sampleRate",
            s.audioContext.sampleRate ? `${s.audioContext.sampleRate} Hz` : "—",
            "text-foreground",
          )}
          {statusRow(
            "baseLatency",
            s.audioContext.baseLatency != null
              ? `${(s.audioContext.baseLatency * 1000).toFixed(1)} ms`
              : "—",
            "text-foreground",
          )}
          {statusRow(
            "outputLatency",
            s.audioContext.outputLatency != null
              ? `${(s.audioContext.outputLatency * 1000).toFixed(1)} ms`
              : "—",
            "text-foreground",
          )}
          {statusRow(
            "resume req / ok / rej",
            `${s.audioContext.resumeRequested} / ${s.audioContext.resumeResolved} / ${s.audioContext.resumeRejected}`,
            s.audioContext.resumeRejected > 0 ? "text-red-400" : "text-foreground",
          )}
          {statusRow("last reason", s.audioContext.lastResumeReason, "text-foreground")}
        </div>

        {/* 4. MESN + Analyser */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Media Source · Analyser
          </div>
          {statusRow(
            "MediaElementAudioSourceNode",
            s.mediaElementSource.lifecycle.toUpperCase(),
            s.mediaElementSource.lifecycle === "created"
              ? "text-emerald-400"
              : s.mediaElementSource.lifecycle === "reused"
                ? "text-sky-400"
                : s.mediaElementSource.lifecycle === "failed"
                  ? "text-red-400"
                  : "text-muted-foreground",
          )}
          {statusRow(
            "InvalidStateError",
            s.mediaElementSource.invalidStateError ? "YES" : "no",
            s.mediaElementSource.invalidStateError ? "text-red-400" : "text-foreground",
          )}
          {statusRow(
            "AnalyserNode",
            s.analyser.lifecycle.toUpperCase(),
            s.analyser.lifecycle === "active"
              ? "text-emerald-400"
              : s.analyser.lifecycle === "created"
                ? "text-amber-400"
                : s.analyser.lifecycle === "failed"
                  ? "text-red-400"
                  : "text-muted-foreground",
          )}
          {statusRow(
            "fftSize",
            s.analyser.fftSize ? String(s.analyser.fftSize) : "—",
            "text-foreground",
          )}
          {statusRow(
            "frequencyBinCount",
            s.analyser.frequencyBinCount ? String(s.analyser.frequencyBinCount) : "—",
            "text-foreground",
          )}
        </div>

        {/* 5. DSP Loop */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            DSP Loop
          </div>
          {statusRow(
            "lifecycle",
            s.dspLoop.lifecycle.toUpperCase(),
            s.dspLoop.lifecycle === "running"
              ? "text-emerald-400"
              : s.dspLoop.lifecycle === "stalled"
                ? "text-amber-400"
                : "text-muted-foreground",
          )}
          {statusRow(
            "actual frequency",
            s.dspLoop.actualHz > 0
              ? `${s.dspLoop.actualHz.toFixed(1)} Hz (target ${s.dspLoop.targetHz}Hz)`
              : "—",
            s.dspLoop.actualHz > 0
              ? Math.abs(s.dspLoop.actualHz - s.dspLoop.targetHz) > 2
                ? "text-amber-400"
                : "text-emerald-400"
              : "text-muted-foreground",
          )}
          {statusRow("tickCount", String(s.dspLoop.tickCount), "text-foreground")}
          {statusRow(
            "last tick",
            fmtAgo(s.dspLoop.lastTickAt),
            s.dspLoop.lastTickAt && Date.now() - s.dspLoop.lastTickAt > 2000
              ? "text-amber-400"
              : "text-foreground",
          )}
          {statusRow("ticks last 1s", String(s.dspLoop.ticksLast1s), "text-foreground")}
          {lastDspFrame && (
            <>
              {statusRow(
                "RMS (last frame)",
                lastDspFrame.rms.toFixed(4),
                lastDspFrame.rms < s.zeroSignalThreshold ? "text-red-400" : "text-emerald-400",
              )}
              {statusRow(
                "Spectral flux (last)",
                lastDspFrame.spectralFlux.toFixed(3),
                "text-foreground",
              )}
              {statusRow(
                "High-freq energy (dB avg)",
                lastDspFrame.highFreqEnergy.toFixed(2),
                "text-foreground",
              )}
            </>
          )}
          {statusRow(
            "consecutive near-zero frames",
            String(s.dspLoop.consecutiveZeroFrames),
            s.dspLoop.consecutiveZeroFrames >= 30 ? "text-red-400" : "text-foreground",
          )}
          {statusRow(
            "zero-signal threshold (RMS)",
            String(s.zeroSignalThreshold),
            "text-foreground",
          )}
        </div>

        {/* 6. Perception + Evidence Fusion */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Perception · Evidence Fusion
          </div>
          {statusRow(
            "Perception",
            s.perception.lifecycle.toUpperCase(),
            s.perception.lifecycle === "active"
              ? "text-emerald-400"
              : s.perception.lifecycle === "degraded"
                ? "text-amber-400"
                : "text-muted-foreground",
          )}
          {statusRow("signals in", String(s.perception.signalsIn), "text-foreground")}
          {statusRow("signals out", String(s.perception.signalsOut), "text-foreground")}
          {statusRow(
            "last signal at",
            s.perception.lastSignalAt ? fmtAgo(s.perception.lastSignalAt) : "—",
            "text-foreground",
          )}
          {statusRow("last signal type", s.perception.lastSignalType ?? "—", "text-foreground")}
          {statusRow("evidence generated", String(s.evidence.evidenceGenerated), "text-foreground")}
          {statusRow("moments generated", String(s.evidence.momentsGenerated), "text-foreground")}
          {statusRow(
            "last moment at",
            s.evidence.lastMomentAt ? fmtAgo(s.evidence.lastMomentAt) : "—",
            "text-foreground",
          )}
          {s.evidence.lastSourceCategories.length > 0 &&
            statusRow(
              "source categories",
              s.evidence.lastSourceCategories.join(", "),
              "text-foreground",
            )}
        </div>

        {/* 7. iOS Gesture Chain */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            iOS Gesture Chain
          </div>
          {statusRow(
            "user gesture",
            s.gesture.lastGestureAt ? fmtAgo(s.gesture.lastGestureAt) : "—",
            s.gesture.lastGestureAt ? "text-emerald-400" : "text-muted-foreground",
          )}
          {statusRow(
            "play() resolved after gesture",
            s.gesture.playResolvedAfterGesture === null
              ? "—"
              : s.gesture.playResolvedAfterGesture
                ? "YES"
                : "no",
            s.gesture.playResolvedAfterGesture === true ? "text-emerald-400" : "text-amber-400",
          )}
          {statusRow(
            "AudioContext resumed after play",
            s.gesture.audioContextResumedAfterPlay === null
              ? "—"
              : s.gesture.audioContextResumedAfterPlay
                ? "YES"
                : "no",
            s.gesture.audioContextResumedAfterPlay === true ? "text-emerald-400" : "text-red-400",
          )}
        </div>

        {/* 8. Page visibility */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Page Lifecycle
          </div>
          {statusRow(
            "visibilityState",
            s.visibility.state,
            s.visibility.state === "visible" ? "text-emerald-400" : "text-amber-400",
          )}
          {statusRow(
            "document.hidden",
            s.visibility.hidden == null ? "—" : String(s.visibility.hidden),
            "text-foreground",
          )}
        </div>

        {/* 9. Health matrix */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Pipeline Health
          </div>
          <HealthRow label="Playback" value={s.health.playback} />
          <HealthRow label="AudioContext" value={s.health.audioContext} />
          <HealthRow label="Media Source" value={s.health.mediaSource} />
          <HealthRow label="Analyser" value={s.health.analyser} />
          <HealthRow label="DSP Loop" value={s.health.dspLoop} />
          <HealthRow label="DSP Signal" value={s.health.dspSignal} />
          <HealthRow label="Perception" value={s.health.perception} />
          <HealthRow label="Evidence Fusion" value={s.health.evidenceFusion} />
        </div>

        {/* 10. Diagnosis */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
            {s.diagnosis === "PIPELINE_ACTIVE" ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            ) : s.diagnosis === "UNKNOWN" || s.diagnosis === "NO_SIGNALS_YET" ? (
              <ListChecks className="h-3 w-3 text-muted-foreground" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-amber-400" />
            )}
            Primary Diagnosis
          </div>
          <div
            className={`text-sm font-bold font-mono ${
              s.diagnosis === "PIPELINE_ACTIVE"
                ? "text-emerald-400"
                : s.diagnosis === "UNKNOWN" || s.diagnosis === "NO_SIGNALS_YET"
                  ? "text-muted-foreground"
                  : "text-amber-400"
            }`}
          >
            {s.diagnosis}
          </div>
          {s.diagnosisEvidence.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
              {s.diagnosisEvidence.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-foreground/40">•</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 11. Timeline */}
        <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Pipeline Timeline (most recent)
          </div>
          {timeline.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60 italic">
              No timeline events yet. Start a track to capture the pipeline lifecycle.
            </p>
          ) : (
            <div className="max-h-44 overflow-y-auto custom-scrollbar space-y-0.5 pr-1">
              {timeline.slice(0, 60).map((t, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] py-0.5">
                  <span className="text-muted-foreground/60 font-mono w-[68px] shrink-0">
                    {fmtTime(t.ts)}
                  </span>
                  <span className="text-foreground/90 flex-1">
                    {timelineLabel(t)}
                    {t.note && <span className="text-muted-foreground/60"> · {t.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[9px] text-amber-400/80 leading-relaxed">
          Forensic observability only — does not modify playback, audio source, AudioContext, or
          media routing. Source URLs are classified as direct|blob|proxy; signed CDN URLs are never
          displayed.
        </p>
      </div>
    </DiagnosticSection>
  );
}
