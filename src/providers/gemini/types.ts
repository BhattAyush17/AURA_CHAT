/**
 * Shared types, interfaces, and constants for the Gemini sub-hook system.
 * Every sub-hook imports from here — no circular dependencies.
 *
 * @module
 */

import type { BehaviorAnalysis } from "@/lib/behavior-client";

// ─── Session ────────────────────────────────────────────────────────

export type SessionState = "idle" | "connecting" | "connected" | "disconnecting" | "error";

export type UIStatus =
  | "idle"
  | "requesting"
  | "connecting"
  | "listening"
  | "reconnecting"
  | "error";

/** Opaque handle to a Gemini bidiGenerateContent session */
export type LiveSession = any;

// ─── Audio ──────────────────────────────────────────────────────────

export const SAMPLE_RATE_IN = 16_000;
export const SAMPLE_RATE_OUT = 24_000;
export const WORKLET_PATH = "./pcm-capture-processor.js";

// ─── Transcript ─────────────────────────────────────────────────────

export interface TranscriptEntry {
  text: string;
  user_initiated: boolean;
  timestamp: number;
}

// ─── Analysis / Emotion ─────────────────────────────────────────────

export interface AuraAnalysis {
  words: string;
  tone: string;
  intent: string;
}

// ─── Connection ─────────────────────────────────────────────────────

export const LIVE_MODELS = [
  "models/gemini-2.0-flash-exp",
  "models/gemini-2.5-flash",
  "models/gemini-2.0-flash",
] as const;

export const MAX_RECONNECT_ATTEMPTS = 3;
export const RECONNECT_DELAY_MS = 1500;
export const MAX_QUEUE = 50;

// ─── Tab heartbeat ──────────────────────────────────────────────────

export const HEARTBEAT_KEY = "aura_primary_tab";
export const HEARTBEAT_INTERVAL = 3000;

// ─── Perf tracking ──────────────────────────────────────────────────

export interface PerfTimings {
  t1: number; // mic opens
  t2: number; // VAD fires (silence detected)
  t3: number; // first byte sent to Gemini (turn complete)
  t4: number; // first audio byte received back
  t5: number; // first audio byte played
  connectStart: number;
  geminiSetup: number;
  geminiGenStart: number;
  tokenThroughput: number;
  turnTokens: number;
}

export function createPerfTimings(): PerfTimings {
  return {
    t1: 0,
    t2: 0,
    t3: 0,
    t4: 0,
    t5: 0,
    connectStart: 0,
    geminiSetup: 0,
    geminiGenStart: 0,
    tokenThroughput: 0,
    turnTokens: 0,
  };
}

// ─── PCM conversion utilities ───────────────────────────────────────

export function float32ToBase64Pcm(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE) as any);
  }
  return btoa(binary);
}

export function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

export function resampleFIR(
  input: Float32Array,
  inputRate: number,
  targetRate: number,
): Float32Array {
  if (inputRate === targetRate) return input;
  const ratio = inputRate / targetRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  const taps = 32;
  const mid = (taps - 1) / 2;
  const cutoff = targetRate / inputRate;
  const kernel = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
    kernel[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    sum += kernel[i];
  }
  for (let i = 0; i < taps; i++) kernel[i] /= sum;
  for (let i = 0; i < outputLength; i++) {
    const centerIdx = Math.floor(i * ratio);
    let sample = 0;
    for (let k = 0; k < taps; k++) {
      const tapIdx = centerIdx - Math.floor(taps / 2) + k;
      if (tapIdx >= 0 && tapIdx < input.length) sample += input[tapIdx] * kernel[k];
    }
    output[i] = sample;
  }
  return output;
}

// ─── Tab management ─────────────────────────────────────────────────

export function claimPrimaryTab(): string {
  let tabId = sessionStorage.getItem("aura_tab_id");
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem("aura_tab_id", tabId);
  }
  localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ tabId, ts: Date.now() }));
  return tabId;
}

export function isPrimaryTab(): boolean {
  const raw = localStorage.getItem(HEARTBEAT_KEY);
  if (!raw) return false;
  try {
    const { tabId, ts } = JSON.parse(raw);
    return (
      tabId === sessionStorage.getItem("aura_tab_id") && Date.now() - ts < HEARTBEAT_INTERVAL * 2
    );
  } catch {
    return false;
  }
}

export function initSessionId(): string {
  let tabSessionId = sessionStorage.getItem("aura_tab_session_id");
  if (!tabSessionId) {
    const baseId = localStorage.getItem("aura_session_v1") ?? crypto.randomUUID();
    tabSessionId = `${baseId}__tab_${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem("aura_tab_session_id", tabSessionId);
  }
  return tabSessionId;
}

/**
 * Determines whether a WebSocket close code or a thrown error message
 * signals a "model not supported / not found" condition.
 */
export function isModelRejection(
  code: number | undefined,
  reason: string | undefined,
  errMsg: string,
): boolean {
  if (code === 1008 || code === 1011) return true;
  const lower = (errMsg + " " + (reason ?? "")).toLowerCase();
  return (
    lower.includes("not supported") ||
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    (lower.includes("model") && lower.includes("invalid")) ||
    lower.includes("404") ||
    lower.includes("400")
  );
}
