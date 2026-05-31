/**
 * Speech Recognition Probe — Independent STT validator.
 *
 * Creates a completely fresh SpeechRecognition instance (never
 * touches Aura's production STT) and traces every lifecycle event
 * to pinpoint the exact failure stage.
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────

export type ProbeEventName =
  | "START"
  | "AUDIO_START"
  | "SOUND_START"
  | "SPEECH_DETECTED"
  | "RESULT"
  | "SPEECH_END"
  | "SOUND_END"
  | "AUDIO_END"
  | "END"
  | "ERROR";

export interface ProbeEvent {
  timestamp: number;
  event: ProbeEventName;
  details?: unknown;
}

export type ProbeStageStatus = "pending" | "pass" | "fail" | "skipped";

export interface ProbeStageState {
  START: ProbeStageStatus;
  AUDIO_START: ProbeStageStatus;
  SOUND_START: ProbeStageStatus;
  SPEECH_DETECTED: ProbeStageStatus;
  RESULT: ProbeStageStatus;
  END: ProbeStageStatus;
  ERROR: ProbeStageStatus;
}

export interface ProbeResult {
  running: boolean;
  events: ProbeEvent[];
  stages: ProbeStageState;
  transcript: string;
  confidence: number;
  errorCode: string | null;
  diagnosis: string;
  success: boolean;
  durationMs: number;
}

export type ProbeListener = (result: ProbeResult) => void;

// ─── Diagnosis Logic ────────────────────────────────────────────────

function diagnose(events: ProbeEvent[], errorCode: string | null, hasTranscript: boolean): { diagnosis: string; success: boolean } {
  const names = events.map((e) => e.event);

  // Error-based diagnoses
  if (errorCode) {
    switch (errorCode) {
      case "not-allowed":
      case "service-not-allowed":
        return { diagnosis: "Permission Failure — microphone access denied by user or browser policy", success: false };
      case "audio-capture":
        return { diagnosis: "Microphone Ownership Conflict — another app or tab may be using the mic", success: false };
      case "network":
        return { diagnosis: "Speech Recognition Backend Failure — browser could not reach its cloud STT service", success: false };
      case "no-speech":
        return { diagnosis: "No Speech Detected — mic was active but no voice was heard within the timeout", success: false };
      case "aborted":
        return { diagnosis: "Recognition Aborted — the session was cancelled before completing", success: false };
      case "language-not-supported":
        return { diagnosis: "Language Not Supported — the browser does not support the requested language", success: false };
      default:
        return { diagnosis: `Unknown Error: ${errorCode}`, success: false };
    }
  }

  // Sequence-based diagnoses
  const hasStart = names.includes("START");
  const hasAudioStart = names.includes("AUDIO_START");
  const hasSoundStart = names.includes("SOUND_START");
  const hasSpeechDetected = names.includes("SPEECH_DETECTED");
  const hasResult = names.includes("RESULT");
  const hasEnd = names.includes("END");

  if (hasResult && hasTranscript) {
    return {
      diagnosis: "Browser Speech Recognition Working — if Aura voice still fails, the issue is in Aura's integration layer",
      success: true,
    };
  }

  if (hasStart && hasSpeechDetected && !hasResult) {
    return {
      diagnosis: "Audio Heard, No Transcript Produced — browser detected speech but failed to transcribe it",
      success: false,
    };
  }

  if (hasStart && hasAudioStart && !hasSoundStart && hasEnd) {
    return {
      diagnosis: "Microphone Active But No Sound Detected — check mic volume or positioning",
      success: false,
    };
  }

  if (hasStart && !hasAudioStart && hasEnd) {
    return {
      diagnosis: "Recognition Started Then Immediately Ended — audio pipeline failed to initialize",
      success: false,
    };
  }

  if (hasStart && hasEnd && !hasSpeechDetected && !hasResult) {
    return {
      diagnosis: "Recognition Started Then Ended Without Input — no speech was detected within the timeout window",
      success: false,
    };
  }

  if (!hasStart && !hasEnd) {
    return { diagnosis: "Probe did not execute — SpeechRecognition may not be available", success: false };
  }

  return { diagnosis: "Inconclusive — partial event sequence received", success: false };
}

// ─── Probe Class ────────────────────────────────────────────────────

export class SpeechRecognitionProbe {
  private recognition: any = null;
  private result: ProbeResult;
  private listeners: Set<ProbeListener> = new Set();
  private startTime: number = 0;

  constructor() {
    this.result = this.freshResult();
  }

  private freshResult(): ProbeResult {
    return {
      running: false,
      events: [],
      stages: {
        START: "pending",
        AUDIO_START: "pending",
        SOUND_START: "pending",
        SPEECH_DETECTED: "pending",
        RESULT: "pending",
        END: "pending",
        ERROR: "pending",
      },
      transcript: "",
      confidence: 0,
      errorCode: null,
      diagnosis: "",
      success: false,
      durationMs: 0,
    };
  }

  // ─── Public API ─────────────────────────────────────────────────

  subscribe(listener: ProbeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getResult(): ProbeResult {
    return { ...this.result, events: [...this.result.events], stages: { ...this.result.stages } };
  }

  start(): void {
    if (this.result.running) return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      this.result = this.freshResult();
      this.result.diagnosis = "SpeechRecognition API not available in this browser";
      this.result.stages.START = "fail";
      this.result.stages.ERROR = "fail";
      this.notify();
      return;
    }

    // Fresh result, fresh instance
    this.result = this.freshResult();
    this.result.running = true;
    this.notify();

    this.recognition = new SR();
    this.recognition.lang = "en-US";
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.startTime = performance.now();
    this.bindEvents();

    try {
      this.recognition.start();
    } catch (err: any) {
      this.pushEvent("ERROR", { error: err?.message || "start() threw" });
      this.markStage("ERROR", "fail");
      this.finalize();
    }
  }

  stop(): void {
    if (!this.recognition) return;
    try { this.recognition.stop(); } catch { /* safe */ }
  }

  // ─── Event Binding ──────────────────────────────────────────────

  private bindEvents(): void {
    const r = this.recognition;

    r.onstart = () => {
      this.pushEvent("START");
      this.markStage("START", "pass");
    };

    r.onaudiostart = () => {
      this.pushEvent("AUDIO_START");
      this.markStage("AUDIO_START", "pass");
    };

    r.onsoundstart = () => {
      this.pushEvent("SOUND_START");
      this.markStage("SOUND_START", "pass");
    };

    r.onspeechstart = () => {
      this.pushEvent("SPEECH_DETECTED");
      this.markStage("SPEECH_DETECTED", "pass");
    };

    r.onresult = (event: any) => {
      let finalTranscript = "";
      let bestConfidence = 0;

      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const alt = res[0];
        if (alt) {
          if (res.isFinal) {
            finalTranscript += alt.transcript;
            bestConfidence = Math.max(bestConfidence, alt.confidence || 0);
          } else {
            // Interim — show live but don't finalize
            finalTranscript += alt.transcript;
            bestConfidence = Math.max(bestConfidence, alt.confidence || 0);
          }
        }
      }

      this.result.transcript = finalTranscript;
      this.result.confidence = Math.round(bestConfidence * 100) / 100;
      this.pushEvent("RESULT", { transcript: finalTranscript, confidence: this.result.confidence });
      this.markStage("RESULT", "pass");
    };

    r.onspeechend = () => {
      this.pushEvent("SPEECH_END");
    };

    r.onsoundend = () => {
      this.pushEvent("SOUND_END");
    };

    r.onaudioend = () => {
      this.pushEvent("AUDIO_END");
    };

    r.onend = () => {
      this.pushEvent("END");
      this.markStage("END", "pass");
      this.finalize();
    };

    r.onerror = (event: any) => {
      const code = event?.error || "unknown";
      this.result.errorCode = code;
      this.pushEvent("ERROR", { error: code, message: event?.message });
      this.markStage("ERROR", "fail");
      // Mark any pending stages as skipped
      this.skipRemaining();
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private pushEvent(name: ProbeEventName, details?: unknown): void {
    this.result.events.push({
      timestamp: Date.now(),
      event: name,
      details,
    });
    this.notify();
  }

  private markStage(stage: keyof ProbeStageState, status: ProbeStageStatus): void {
    this.result.stages[stage] = status;
    this.notify();
  }

  private skipRemaining(): void {
    const stages = this.result.stages;
    for (const key of Object.keys(stages) as (keyof ProbeStageState)[]) {
      if (stages[key] === "pending") {
        stages[key] = "skipped";
      }
    }
  }

  private finalize(): void {
    this.result.running = false;
    this.result.durationMs = Math.round(performance.now() - this.startTime);

    // Skip any remaining pending stages
    this.skipRemaining();

    // Run diagnosis
    const { diagnosis, success } = diagnose(
      this.result.events,
      this.result.errorCode,
      this.result.transcript.trim().length > 0,
    );
    this.result.diagnosis = diagnosis;
    this.result.success = success;

    this.recognition = null;
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getResult();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* diagnostics must never crash */ }
    }
  }

  // ─── Export ─────────────────────────────────────────────────────

  downloadReport(): void {
    const device = (window as any).auraDiagnostics?.device || {};
    const report = {
      exportedAt: new Date().toISOString(),
      device,
      events: this.result.events,
      transcript: this.result.transcript,
      confidence: this.result.confidence,
      diagnosis: this.result.diagnosis,
      success: this.result.success,
      errorCode: this.result.errorCode,
      durationMs: this.result.durationMs,
      stages: this.result.stages,
    };
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `speech-probe-report-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
