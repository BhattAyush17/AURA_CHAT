/**
 * AURA Diagnostics Engine — Pure observation layer.
 *
 * Collects device capability snapshots without touching any production
 * voice, STT, TTS, LLM, memory, or WebSocket logic.
 *
 * Every probe is wrapped in try/catch so a failure in diagnostics
 * never propagates to the main application.
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────
import { AudioEnvironment, detectAudioEnvironment } from "../../audioRuntime/AudioEnvironment";

export interface DeviceInfo {
  browser: string;
  browserVersion: string;
  platform: string;
  userAgent: string;
  mobile: boolean;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  online: boolean;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  language: string;
  touchSupport: boolean;
}

export interface MicrophoneInfo {
  supported: boolean;
  permission: PermissionState | "unknown";
  stream: boolean;
  failureReason: string | null;
  sampleRate: number | null;
  channelCount: number | null;
  label: string | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

export interface AudioContextInfo {
  available: boolean;
  engine: "AudioContext" | "webkitAudioContext" | "none";
  state: AudioContextState | "unavailable";
  sampleRate: number | null;
  maxChannelCount: number | null;
}

export interface SpeechRecognitionInfo {
  supported: boolean;
  engine: "SpeechRecognition" | "webkitSpeechRecognition" | "none";
}

export interface WebSocketInfo {
  connected: boolean;
  latencyMs: number | null;
  failureReason: string | null;
}

export interface PlaybackInfo {
  audioPlayable: boolean;
  failureReason: string | null;
}

export interface WakeLockInfo {
  supported: boolean;
}

export interface CompatibilityScore {
  microphone: boolean;
  speechRecognition: boolean;
  audioEngine: boolean;
  playback: boolean;
  webSocket: boolean;
  wakeLock: boolean;
  overall: number;
}

export interface DiagnosticSnapshot {
  timestamp: number;
  version: string;
  device: DeviceInfo;
  audioEnvironment: AudioEnvironment;
  microphone: MicrophoneInfo;
  audio: AudioContextInfo;
  speech: SpeechRecognitionInfo;
  websocket: WebSocketInfo;
  playback: PlaybackInfo;
  wakeLock: WakeLockInfo;
  compatibility: CompatibilityScore;
}

// ─── Browser Detection ──────────────────────────────────────────────

function detectBrowser(ua: string): { name: string; version: string } {
  // Order matters — check specific engines before generic ones
  const tests: [RegExp, string][] = [
    [/edg\/([\d.]+)/i, "Edge"],
    [/opr\/([\d.]+)/i, "Opera"],
    [/samsungbrowser\/([\d.]+)/i, "Samsung Internet"],
    [/chrome\/([\d.]+)/i, "Chrome"],
    [/firefox\/([\d.]+)/i, "Firefox"],
    [/safari\/([\d.]+)/i, "Safari"],
  ];
  for (const [regex, name] of tests) {
    const match = ua.match(regex);
    if (match) return { name, version: match[1] };
  }
  return { name: "Unknown", version: "0" };
}

// ─── Probes ─────────────────────────────────────────────────────────

export function probeDevice(): DeviceInfo {
  try {
    const ua = navigator.userAgent;
    const { name, version } = detectBrowser(ua);
    const mobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
      (navigator.maxTouchPoints > 0 && /Mobi|Tablet/i.test(ua));

    return {
      browser: name,
      browserVersion: version,
      platform: navigator.platform || "unknown",
      userAgent: ua,
      mobile,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      online: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemory: (navigator as any).deviceMemory ?? null,
      language: navigator.language,
      touchSupport: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    };
  } catch {
    return {
      browser: "Unknown", browserVersion: "0", platform: "unknown",
      userAgent: "", mobile: false, screenWidth: 0, screenHeight: 0,
      devicePixelRatio: 1, online: false, hardwareConcurrency: 0,
      deviceMemory: null, language: "en", touchSupport: false,
    };
  }
}

export async function probeMicrophone(): Promise<MicrophoneInfo> {
  const base: MicrophoneInfo = {
    supported: false, permission: "unknown", stream: false,
    failureReason: null, sampleRate: null, channelCount: null, label: null,
    echoCancellation: null, noiseSuppression: null, autoGainControl: null
  };

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      base.failureReason = "getUserMedia API not available";
      return base;
    }
    base.supported = true;

    // Check permission state (non-destructive — doesn't trigger prompt)
    try {
      const permStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
      base.permission = permStatus.state;
    } catch {
      base.permission = "unknown";
    }

    // Actually acquire a stream (will trigger permission prompt if needed)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    base.stream = true;

    const track = stream.getAudioTracks()[0];
    if (track) {
      const settings = track.getSettings();
      base.sampleRate = settings.sampleRate ?? null;
      base.channelCount = settings.channelCount ?? null;
      base.label = track.label || null;
      base.echoCancellation = settings.echoCancellation ?? null;
      base.noiseSuppression = settings.noiseSuppression ?? null;
      base.autoGainControl = settings.autoGainControl ?? null;
      // Release immediately — don't hold the mic open
      track.stop();
    }
    stream.getTracks().forEach((t) => t.stop());

    base.permission = "granted";
  } catch (err: any) {
    base.stream = false;
    if (err?.name === "NotAllowedError") {
      base.permission = "denied";
      base.failureReason = "Permission denied by user";
    } else if (err?.name === "NotFoundError") {
      base.failureReason = "No microphone hardware found";
    } else if (err?.name === "NotReadableError") {
      base.failureReason = "Microphone in use by another application";
    } else {
      base.failureReason = err?.message || "Unknown microphone error";
    }
  }
  return base;
}

export function probeAudioContext(): AudioContextInfo {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) {
      return { available: false, engine: "none", state: "unavailable", sampleRate: null, maxChannelCount: null };
    }

    const engine = (window as any).AudioContext ? "AudioContext" : "webkitAudioContext";
    const ctx = new AC();
    const info: AudioContextInfo = {
      available: true,
      engine: engine as AudioContextInfo["engine"],
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      maxChannelCount: ctx.destination.maxChannelCount,
    };
    ctx.close().catch(() => {});
    return info;
  } catch {
    return { available: false, engine: "none", state: "unavailable", sampleRate: null, maxChannelCount: null };
  }
}

export function probeSpeechRecognition(): SpeechRecognitionInfo {
  try {
    if ((window as any).SpeechRecognition) {
      return { supported: true, engine: "SpeechRecognition" };
    }
    if ((window as any).webkitSpeechRecognition) {
      return { supported: true, engine: "webkitSpeechRecognition" };
    }
    return { supported: false, engine: "none" };
  } catch {
    return { supported: false, engine: "none" };
  }
}

export async function probeWebSocket(): Promise<WebSocketInfo> {
  // Lightweight echo test against a public WebSocket echo server.
  // Falls back gracefully if offline or blocked.
  return new Promise((resolve) => {
    try {
      const start = performance.now();
      const ws = new WebSocket("wss://echo.websocket.org");
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ connected: false, latencyMs: null, failureReason: "Timeout (5s)" });
      }, 5000);

      ws.onopen = () => {
        ws.send("aura-diag-ping");
      };
      ws.onmessage = () => {
        clearTimeout(timeout);
        const latency = Math.round(performance.now() - start);
        ws.close();
        resolve({ connected: true, latencyMs: latency, failureReason: null });
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        // WebSocket connectivity test failed — but that's expected in many
        // environments. We still mark it as tested.
        resolve({ connected: false, latencyMs: null, failureReason: "WebSocket connection failed (echo server may be unavailable)" });
      };
    } catch (err: any) {
      resolve({ connected: false, latencyMs: null, failureReason: err?.message || "WebSocket not supported" });
    }
  });
}

export async function probePlayback(): Promise<PlaybackInfo> {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return { audioPlayable: false, failureReason: "No AudioContext available" };

    const ctx = new AC();
    // Resume AudioContext (required on mobile after user gesture)
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    // Generate a 50ms silent tone at 440Hz (inaudible volume)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.001; // Nearly silent
    osc.frequency.value = 440;
    osc.connect(gain).connect(ctx.destination);
    osc.start();

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        osc.stop();
        osc.disconnect();
        gain.disconnect();
        resolve();
      }, 50);
    });

    await ctx.close();
    return { audioPlayable: true, failureReason: null };
  } catch (err: any) {
    return { audioPlayable: false, failureReason: err?.message || "Audio playback test failed" };
  }
}

export function probeWakeLock(): WakeLockInfo {
  try {
    return { supported: "wakeLock" in navigator };
  } catch {
    return { supported: false };
  }
}

// ─── Compatibility Score ────────────────────────────────────────────

export function computeCompatibility(
  mic: MicrophoneInfo,
  speech: SpeechRecognitionInfo,
  audio: AudioContextInfo,
  playback: PlaybackInfo,
  ws: WebSocketInfo,
  wl: WakeLockInfo,
): CompatibilityScore {
  const checks = {
    microphone: mic.supported && mic.stream,
    speechRecognition: speech.supported,
    audioEngine: audio.available,
    playback: playback.audioPlayable,
    webSocket: ws.connected,
    wakeLock: wl.supported,
  };

  // Weighted scoring: mic + speech + audio + playback are critical (20% each),
  // WebSocket and Wake Lock are nice-to-have (10% each)
  const weights = { microphone: 20, speechRecognition: 20, audioEngine: 20, playback: 20, webSocket: 10, wakeLock: 10 };
  let score = 0;
  for (const [key, passed] of Object.entries(checks)) {
    if (passed) score += weights[key as keyof typeof weights];
  }

  return { ...checks, overall: score };
}

// ─── Full Diagnostic Run ────────────────────────────────────────────

export async function runFullDiagnostics(): Promise<DiagnosticSnapshot> {
  const device = probeDevice();
  const audioEnvironment = await detectAudioEnvironment();
  const [microphone, websocket, playback] = await Promise.all([
    probeMicrophone(),
    probeWebSocket(),
    probePlayback(),
  ]);
  const audio = probeAudioContext();
  const speech = probeSpeechRecognition();
  const wakeLock = probeWakeLock();
  const compatibility = computeCompatibility(microphone, speech, audio, playback, websocket, wakeLock);

  const snapshot: DiagnosticSnapshot = {
    timestamp: Date.now(),
    version: "1.0.0",
    device,
    audioEnvironment,
    microphone,
    audio,
    speech,
    websocket,
    playback,
    wakeLock,
    compatibility,
  };

  // Expose on window for console access
  (window as any).auraDiagnostics = snapshot;

  return snapshot;
}

// ─── Export Helper ──────────────────────────────────────────────────

export function downloadDiagnosticReport(snapshot: DiagnosticSnapshot): void {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aura-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
