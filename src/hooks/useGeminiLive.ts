import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { emitLatency } from "@/components/LatencyMeter";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { getGeminiSystemPrompt, getGreetingPrompt, isLateNightHour } from "@/lib/gemini-prompt";
import { getGeminiKey } from "@/lib/api";
import { getStorageManager } from "@/lib/storage/manager";
import { generateSeed } from "@/lib/utils/seed-generator";
import { ENDPOINTS } from "@/config/api";
import {
  getCredential,
  clearAllCredentials,
  hasRequiredCredentials,
  hasSupabaseCredentials,
} from "@/lib/credentials";
import {
  shouldShowSetupPrompt,
  incrementConversationCount,
  getConversationCount,
} from "@/lib/usage-tracker";
import { analyzeBehavior } from "@/lib/behavior-client";
import { saveSyncMeta } from "@/lib/sync-meta";
import { resolveUserId } from "@/lib/user-identity";

export interface AuraAnalysis {
  words: string;
  tone: string;
  intent: string;
}

export type SessionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';
const WORKLET_PATH = "/pcm-capture-processor.js";
let sessionEndInProgress = false;

/* ------------------------------------------------------------------ */
/*  Model Fallback Cascade                                             */
/*                                                                     */
/*  Only real, confirmed Live API (bidiGenerateContent) model IDs.    */
/*  Ordered: cheapest/most-available first, newer/larger last.        */
/*  The cascade tries each in sequence on any rejection (HTTP or WS). */
/* ------------------------------------------------------------------ */
const LIVE_MODELS = [
  "models/gemini-2.5-flash-native-audio-latest",
] as const;

/**
 * Determines whether a WebSocket close code or a thrown error message
 * signals a "model not supported / not found" condition that should
 * trigger the next model in the cascade rather than a generic retry.
 */
function isModelRejection(code: number | undefined, reason: string | undefined, errMsg: string): boolean {
  // WS close codes Google uses for unsupported / not-found models
  if (code === 1008 || code === 1011) return true;
  // HTTP-level rejections surface as thrown errors before WS opens
  const lower = (errMsg + " " + (reason ?? "")).toLowerCase();
  return (
    lower.includes("not supported") ||
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("model") && lower.includes("invalid") ||
    lower.includes("404") ||
    lower.includes("400")
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const HEARTBEAT_KEY = "aura_primary_tab";
const HEARTBEAT_INTERVAL = 3000;

const claimPrimaryTab = () => {
  let tabId = sessionStorage.getItem("aura_tab_id");
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem("aura_tab_id", tabId);
  }
  localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ tabId, ts: Date.now() }));
  return tabId;
};

const isPrimaryTab = () => {
  const raw = localStorage.getItem(HEARTBEAT_KEY);
  if (!raw) return false;
  try {
    const { tabId, ts } = JSON.parse(raw);
    return tabId === sessionStorage.getItem("aura_tab_id") && Date.now() - ts < HEARTBEAT_INTERVAL * 2;
  } catch { return false; }
};

const initSessionId = () => {
  let tabSessionId = sessionStorage.getItem("aura_tab_session_id");
  if (!tabSessionId) {
    const baseId = localStorage.getItem("aura_session_v1") ?? crypto.randomUUID();
    tabSessionId = `${baseId}__tab_${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem("aura_tab_session_id", tabSessionId);
  }
  return tabSessionId;
};

function float32ToBase64Pcm(float32: Float32Array): string {
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

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

function resampleFIR(input: Float32Array, inputRate: number, targetRate: number): Float32Array {
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

/* ------------------------------------------------------------------ */
/*  The Hook                                                           */
/* ------------------------------------------------------------------ */

type LiveSession = any;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1500;
const MAX_QUEUE = 50;

export function useGeminiLive(mode: string = "adaptive", voice: string = "Zephyr") {
  const storageManager = getStorageManager();

  const deviceId = useMemo(() => {
    let id = localStorage.getItem("aura_device_id");
    if (!id) {
      id = `device_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem("aura_device_id", id);
    }
    return id;
  }, []);

  const [status, setStatus] = useState<"idle" | "requesting" | "connecting" | "listening" | "reconnecting" | "error">("idle");
  const sessionState = useRef<SessionState>('idle');
  const audioQueue = useRef<Float32Array[]>([]);
  const retryDelay = useRef(1000);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  const isStartingRef = useRef(false);
  const backendAvailable = useRef(true);

  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // --- Cascade state ---
  // currentModelIndexRef: which model in LIVE_MODELS we are currently trying
  // isCascadingRef: true while we are silently cycling through models (suppresses error UI)
  const currentModelIndexRef = useRef(0);
  const isCascadingRef = useRef(false);
  const isSessionReadyRef = useRef(false);
  const firstTokenEmitted = useRef(false);
  const lastChunkTime = useRef<number | null>(null);
  const roundTripStartRef = useRef<number>(0);
  const pauseSinceLastTurnRef = useRef<number>(0);
  const lastTurnEndTimeRef = useRef<number>(performance.now());
  const isFirstChunkOfTurnRef = useRef<boolean>(true);
  const currentRmsRef = useRef<number>(0.02);
  const sessionTurnCountRef = useRef<number>(0);
  const [voiceLanguage, setVoiceLanguage] = useState<string>("hi-IN");
  const voiceLanguageRef = useRef<string>("hi-IN");
  useEffect(() => { voiceLanguageRef.current = voiceLanguage; }, [voiceLanguage]);

  const setIsSpeakingState = (val: boolean) => {
    setIsSpeaking(val);
    isSpeakingRef.current = val;
  };

  const [volume, setVolume] = useState(0);
  const [isActiveVoice, setIsActiveVoice] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [auraState, setAuraState] = useState<AuraAnalysis | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sessionStartTime] = useState<number>(() => Date.now());
  const [warning, setWarning] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCloudSyncPrompt, setShowCloudSyncPrompt] = useState(false);

  const [memories, setMemories] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("aura_memories") || "[]"); } catch { return []; }
  });

  const addMemory = useCallback((fact: string) => {
    setMemories((prev) => {
      const updated = [...prev, fact].slice(-12);
      localStorage.setItem("aura_memories", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const [transcript, setTranscript] = useState<any[]>([]);
  const transcriptRef = useRef<any[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string>("local-user");
  const userApiKeyRef = useRef<string>("");
  const seedRef = useRef<{ content: string; last_updated: number; memories: string[] }>({ content: "", last_updated: 0, memories: [] });

  const sessionHighlightsRef = useRef<string[]>([]);
  const turnCountRef = useRef<number>(0);

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addTurn = useCallback((text: string, userInitiated: boolean) => {
    const turn = { text, user_initiated: userInitiated, timestamp: Date.now() };
    transcriptRef.current = [...transcriptRef.current, turn];
    sessionStorage.setItem("aura_transcript_backup", JSON.stringify(transcriptRef.current));
    setTranscript((prev) => {
      const updated = [...prev, turn];
      return updated.length > 100 ? updated.slice(-100) : updated;
    });

    if (userInitiated && sessionIdRef.current) {
      analyzeBehavior(text, sessionIdRef.current, currentRmsRef.current, pauseSinceLastTurnRef.current, modeRef.current, undefined, userIdRef.current)
        .then(result => {
          if (result) {
            applyBehavioralInjection(result);

            // Apply memory enrichment if ChromaDB returned something
            // Gate: skip during opening arc — no history yet, fallback adds noise
            if (
              result.memory_enrichment &&
              result.sensing_state?.arc !== "opening" &&
              sessionRef.current &&
              isSessionReadyRef.current
            ) {
              (sessionRef.current as any).sendClientContent({
                turns: [{
                  role: "user",
                  parts: [{ text: result.memory_enrichment }]
                }],
                turnComplete: false
              });
            }

            // Update memory layer based on chroma_ready
            if (result.sensing_state?.chroma_ready) {
              emitLatency("memoryLayer", "deep");
            }

            // Language adaptation after first real turn
            if (result.language_profile && sessionTurnCountRef.current <= 2) {
              const langMode = result.language_profile.mode;
              if (langMode === "hindi_native") {
                setVoiceLanguage("hi-IN");
              } else if (langMode === "english") {
                setVoiceLanguage("en-IN");
              } else {
                setVoiceLanguage("hi-IN");
              }
            }
            sessionTurnCountRef.current += 1;

            const cadenceMap: Record<string, number> = {
              opening: 400,
              building: 200,
              plateau: 300,
              declining: 800,
              withdrawing: 1200,
              comfortable_silence: 2000,
              companion_burst: 1500,
              presence: 2000,
            };

            const arc = result?.sensing_state?.arc ?? "opening";
            const delay = cadenceMap[arc] ?? 300;

            setTimeout(() => {
              (sessionRef.current as any)?.sendClientContent({
                turns: [{
                  role: "user",
                  parts: [{ text }]
                }],
                turnComplete: true
              });
            }, delay);
          }
        })
        .catch(err => console.warn('[AURA] Behavioral analysis failed silently:', err));

      turnCountRef.current += 1;

      // Capture significant turns as session highlights
      if (
        text.length > 15 &&
        sessionHighlightsRef.current.length < 5
      ) {
        sessionHighlightsRef.current.push(
          text.slice(0, 80)
        );
      }

      // Every 5 turns inject a session thread reference
      if (
        turnCountRef.current % 5 === 0 &&
        sessionHighlightsRef.current.length > 1 &&
        sessionRef.current &&
        isSessionReadyRef.current
      ) {
        const refStr = sessionHighlightsRef.current[0];
        (sessionRef.current as any).sendClientContent({
          turns: [{
            role: "user",
            parts: [{
              text: `[THREAD] Earlier: "${refStr}" — use naturally if it connects. Don't force it. [/THREAD]`
            }]
          }],
          turnComplete: false
        });
      }
    }
  }, [modeRef]);

  const applyBehavioralInjection = useCallback((result: any) => {
    if (!result.behavior_instructions || !sessionRef.current) return;
    try {
      const isUrgent = result.sensing_state?.injection_type === "urgent";

      if (isUrgent) {
          console.log(`[AURA] Urgent injection — mode: ${result.sensing_state?.mode}, turn: ${result.sensing_state?.session_turn}`);
          // Send injection as part of current turn bundle BEFORE turnComplete
          (sessionRef.current as any).sendClientContent({
              turns: [{
                  role: "user",
                  parts: [{ text: `[BEHAVIORAL CONTEXT]: ${result.behavior_instructions}` }]
              }],
              turnComplete: false
          });
          return;
      }

      // Existing passive injection logic stays unchanged below
      (sessionRef.current as any).sendClientContent({
          turns: [{
              role: "user",
              parts: [{ text: result.behavior_instructions }]
          }],
          turnComplete: false
      });
    } catch (e) {
      console.warn("[AURA] Failed to apply behavioral injection:", e);
    }
  }, []);

  const getDailyUsageMinutes = useCallback((userId: string): number => {
    const key = `aura_daily_usage_${userId}_${new Date().toDateString()}`;
    return parseInt(localStorage.getItem(key) ?? "0", 10);
  }, []);

  const addDailyUsage = useCallback((userId: string, minutes: number) => {
    const key = `aura_daily_usage_${userId}_${new Date().toDateString()}`;
    localStorage.setItem(key, String(getDailyUsageMinutes(userId) + minutes));
  }, [getDailyUsageMinutes]);

  const handleSessionEnd = useCallback(async () => {
    if (sessionEndInProgress) return;
    sessionEndInProgress = true;
    const t = transcriptRef.current;
    try {
      if (!t || t.length < 3 || !sessionIdRef.current) return;
      const sessionData = { session_id: sessionIdRef.current, transcript: t, user_id: userIdRef.current, last_active: new Date().toISOString() };
      const prevSeed = await storageManager.loadSeed();
      const newSeed = generateSeed(t, prevSeed ?? undefined);
      await storageManager.saveSeed(newSeed);
      await storageManager.save(sessionData);
      if (hasSupabaseCredentials()) {
        try {
          storageManager.initializeRemoteAdapter();
          await storageManager.save(sessionData);
          await storageManager.saveSeed(newSeed);
        } catch {}
      }
      saveSyncMeta(userIdRef.current, { updatedAt: newSeed.updatedAt, hasCloudCopy: hasSupabaseCredentials() });
      incrementConversationCount(userIdRef.current);
      clearAllCredentials();
      localStorage.removeItem("aura_session_v1");
      sessionStorage.removeItem("aura_transcript_backup");
      addDailyUsage(userIdRef.current, Math.ceil((Date.now() - sessionStartTime) / 60000));
      // Gap 5: Persist session end time for gap context in next greeting
      try { localStorage.setItem("aura_last_session_end", String(Date.now())); } catch {}
      if (shouldShowSetupPrompt(userIdRef.current)) setShowCloudSyncPrompt(true);
    } catch (err) {
      console.error("[AURA] Session end failed:", err);
    } finally {
      [inactivityTimer, silenceTimerRef, hardCapTimerRef].forEach(r => { if (r.current) clearTimeout(r.current); r.current = null; });
      sessionEndInProgress = false;
    }
  }, [storageManager, sessionStartTime, addDailyUsage]);

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      setWarning("Still there? Session will close in 2 minutes.");
      silenceTimerRef.current = setTimeout(async () => {
        await handleSessionEnd();
        teardownResources();
        setWarning(null);
      }, 120000);
    }, 180000);
  }, [handleSessionEnd]);

  const recordActivity = useCallback(() => { lastActivityRef.current = Date.now(); resetSilenceTimer(); }, [resetSilenceTimer]);
  useEffect(() => { if (transcript.length > 0) recordActivity(); }, [transcript, recordActivity]);

  useEffect(() => {
    const myTabId = claimPrimaryTab();
    const interval = setInterval(() => {
      const raw = localStorage.getItem(HEARTBEAT_KEY);
      try {
        const current = raw ? JSON.parse(raw) : null;
        if (!current || current.tabId === myTabId || Date.now() - current.ts > HEARTBEAT_INTERVAL * 2)
          localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ tabId: myTabId, ts: Date.now() }));
      } catch { claimPrimaryTab(); }
    }, HEARTBEAT_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const resume = async () => { if (audioContextRef.current?.state === "suspended") await audioContextRef.current.resume(); };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => { window.removeEventListener("pointerdown", resume); window.removeEventListener("keydown", resume); };
  }, []);

  useEffect(() => {
    function handleUnload() {
      if (transcriptRef.current?.length >= 3 && isPrimaryTab()) {
        localStorage.setItem(`aura_seed_${userIdRef.current}`, JSON.stringify(generateSeed(transcriptRef.current)));
        localStorage.setItem(`aura_conversation_count_${userIdRef.current}`, String(getConversationCount(userIdRef.current) + 1));
        sessionStorage.setItem("aura_pending_session", "true");
      }
    }
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const sessionRef = useRef<LiveSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeAudioNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const vadHangtimeRef = useRef<number>(0);
  const isVADActiveRef = useRef<boolean>(false);
  const noiseFloorRef = useRef<number>(0.01);
  const frameRef = useRef<number>(0);
  const updateVolumeRef = useRef<() => void>(null!);

  const onsetCountRef = useRef<number>(0);
  const ONSET_THRESHOLD = 0.015;
  const ONSET_FRAMES = 3;

  const interruptPlayback = useCallback((gracefulMs: number = 20) => {
    const now = audioContextRef.current?.currentTime || 0;
    activeAudioNodesRef.current.forEach(node => { try { node.stop(now + gracefulMs / 1000); } catch {} });
    activeAudioNodesRef.current.clear();
    nextPlayTimeRef.current = now;
    setIsSpeakingState(false);
  }, []);

  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const userClosedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  const updateVolume = useCallback(() => {
    if (!inputAnalyserRef.current) return;
    const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
    inputAnalyserRef.current.getByteTimeDomainData(dataArray);
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const norm = dataArray[i] / 128.0 - 1.0;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    setVolume(rms);
    currentRmsRef.current = rms;

    if (rms < noiseFloorRef.current) noiseFloorRef.current = noiseFloorRef.current * 0.999 + rms * 0.001;
    else if (rms < noiseFloorRef.current * 2) noiseFloorRef.current = noiseFloorRef.current * 0.995 + rms * 0.005;

    const triggerThreshold = Math.max(noiseFloorRef.current * 2.5, 0.02);
    if (rms > ONSET_THRESHOLD) {
      onsetCountRef.current++;
      if (onsetCountRef.current >= ONSET_FRAMES && isSpeakingRef.current) interruptPlayback(20);
    } else { onsetCountRef.current = 0; }

    if (rms > triggerThreshold) {
      vadHangtimeRef.current = performance.now();
      if (!isVADActiveRef.current) { isVADActiveRef.current = true; setIsActiveVoice(true); setIsThinking(true); }
    } else {
      if (isVADActiveRef.current && performance.now() - vadHangtimeRef.current > 500) {
        isVADActiveRef.current = false;
        setIsActiveVoice(false);
        setIsThinking(true);
      }
    }
    frameRef.current = requestAnimationFrame(updateVolumeRef.current);
  }, [interruptPlayback]);
  updateVolumeRef.current = updateVolume;

  const getInputFrequencyData = useCallback(() => {
    const arr = new Uint8Array(64);
    if (inputAnalyserRef.current) {
      const full = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
      inputAnalyserRef.current.getByteFrequencyData(full);
      for (let i = 0; i < 64; i++) arr[i] = full[i];
    }
    return arr;
  }, []);

  const getOutputFrequencyData = useCallback(() => {
    const arr = new Uint8Array(64);
    if (outputAnalyserRef.current) {
      const full = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
      outputAnalyserRef.current.getByteFrequencyData(full);
      for (let i = 0; i < 64; i++) arr[i] = full[i];
    }
    return arr;
  }, []);

  const teardownResources = useCallback(() => {
    if (sessionRef.current) { try { sessionRef.current.close?.(); } catch {} sessionRef.current = null; }
    if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = 0; }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      if (workletNodeRef.current.port) workletNodeRef.current.port.close();
      workletNodeRef.current = null;
    }
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => { t.onended = null; t.stop(); });
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      activeAudioNodesRef.current.forEach(n => { try { n.stop(); } catch {} });
      activeAudioNodesRef.current.clear();
      if (audioContextRef.current.state !== 'closed') audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    sessionTurnCountRef.current = 0;
    sessionHighlightsRef.current = [];
    turnCountRef.current = 0;
  }, []);

  const endSession = useCallback(async () => {
    sessionState.current = 'disconnecting';
    userClosedRef.current = true;
    await handleSessionEnd();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptsRef.current = 0;
    currentModelIndexRef.current = 0;
    isCascadingRef.current = false;
    teardownResources();
    setStatus("idle");
    sessionState.current = 'idle';
    setIsSpeakingState(false);
    setVolume(0);
    setIsActiveVoice(false);
    setIsThinking(false);
    isVADActiveRef.current = false;
    noiseFloorRef.current = 0.01;
    isStartingRef.current = false;
  }, [teardownResources, handleSessionEnd]);

  // ---------------------------------------------------------------------------
  // connectSession — core connection logic with built-in cascade on rejection
  //
  // Uses a ref (connectSessionRef) so that the onclose / onerror callbacks
  // always call the *latest* version without stale-closure issues.
  // ---------------------------------------------------------------------------
  const connectSessionRef = useRef<() => Promise<void>>(async () => {});

  const connectSession = useCallback(async () => {
    if (sessionState.current === 'connecting' || sessionState.current === 'connected') return;

    // If we've exhausted every model, surface a real error
    if (currentModelIndexRef.current >= LIVE_MODELS.length) {
      console.error("[AURA] All models in cascade exhausted. Cannot connect.");
      isCascadingRef.current = false;
      sessionState.current = 'error';
      setStatus("error");
      setLastError("No compatible model found for this API key. Please check your key's tier and region.");
      return;
    }

    const targetModel = LIVE_MODELS[currentModelIndexRef.current];
    console.log(`[AURA] Connecting... model [${currentModelIndexRef.current + 1}/${LIVE_MODELS.length}]: ${targetModel}`);

    sessionState.current = 'connecting';
    // Only show "connecting" UI on first attempt; cascade is invisible to user
    if (!isCascadingRef.current) setStatus("connecting");
    const connectTimeoutId = setTimeout(() => {
      if (statusRef.current === "connecting") {
        teardownResources();
        setStatus("idle");
        setLastError("Connection timed out. Check your internet connection or API key and try again.");
        isStartingRef.current = false;
      }
    }, 12000);
    setLastError(null);
    teardownResources();

    try {
      const apiKey = getGeminiKey();
      if (!apiKey || apiKey.trim().length < 10) {
        setLastError("Gemini API key missing or invalid. Open Settings to add it.");
        setStatus("idle");
        isStartingRef.current = false;
        return;
      }
      userApiKeyRef.current = apiKey;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (sessionState.current === 'disconnecting' || userClosedRef.current) return;
          sessionState.current = 'error';
          setStatus('error');
          setLastError("Microphone access revoked.");
          teardownResources();
        };
      });

      streamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const inAnalyser = audioContext.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;

      const outAnalyser = audioContext.createAnalyser();
      outAnalyser.fftSize = 256;
      outAnalyser.connect(audioContext.destination);
      outputAnalyserRef.current = outAnalyser;

      audioContext.createMediaStreamSource(stream).connect(inAnalyser);
      nextPlayTimeRef.current = audioContext.currentTime;

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "v1beta" }
      });

      // ai.live.connect() throws an HTTP-level error if the model is invalid
      // before a WebSocket is even opened. We catch that here and cascade.
      let session: LiveSession;
      const connectStart = performance.now();
      try {
        session = await ai.live.connect({
          model: "models/gemini-2.5-flash-native-audio-latest",
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
              languageCode: voiceLanguageRef.current
            },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH" as any,
                endOfSpeechSensitivity: "END_SENSITIVITY_LOW" as any,
                prefixPaddingMs: 20,
                silenceDurationMs: 800,
              }
            },
            systemInstruction: {
              parts: [{ text: getGeminiSystemPrompt(seedRef.current.content ? [seedRef.current.content] : [], modeRef.current) }]
            },
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "saveMemory",
                    parameters: {
                      type: Type.OBJECT,
                      properties: { fact: { type: Type.STRING } },
                      required: ["fact"]
                    }
                  },
                  {
                    name: "updateAnalysis",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        user_words: { type: Type.STRING },
                        detected_tone: { type: Type.STRING },
                        perceived_intent: { type: Type.STRING }
                      },
                      required: ["user_words", "detected_tone", "perceived_intent"]
                    }
                  }
                ]
              }
            ]
          },
          callbacks: {
            onopen: () => {
              clearTimeout(connectTimeoutId);
              emitLatency("geminiConnect", performance.now() - connectStart);
              console.log(`[AURA] ✓ Connected to ${targetModel}`);
              firstTokenEmitted.current = false;
              isCascadingRef.current = false;
              sessionState.current = 'connected';
              setStatus("listening");
              retryDelay.current = 1000;
              reconnectAttemptsRef.current = 0;

              // --- FIXED: Handshake Delay + Greeting (Bug #2) ---
              setTimeout(() => {
                // Bail if socket died during the 500ms handshake window
                if (sessionState.current !== 'connected') {
                  console.warn("[AURA] Socket closed during handshake delay. Aborting greeting.");
                  return;
                }
                isSessionReadyRef.current = true;
                // Send greeting AFTER connection is confirmed stable
                if (transcriptRef.current.length === 0 && sessionRef.current) {
                  try {
                    (sessionRef.current as any).sendClientContent({
                      turns: [{ role: "user", parts: [{ text: getGreetingPrompt(seedRef.current.memories || [], modeRef.current) }] }],
                      turnComplete: true
                    });
                    setIsThinking(true);
                    roundTripStartRef.current = performance.now();
                    console.log("[AURA] 🎤 Greeting sent.");
                  } catch (e) {
                    console.warn("[AURA] Failed to send greeting:", e);
                  }
                }
              }, 150);

              if (audioContext.state !== 'closed') void audioContext.resume();
              frameRef.current = requestAnimationFrame(updateVolumeRef.current);
            },

            onmessage: (message: any) => {
              const msg = message as any;
              console.log("[AURA] Incoming:", msg);
              if (msg.goAway) {
                console.error("[AURA] Server requested disconnect (goAway). Stopping session.");
                teardownResources();
                return;
              }
              if (msg.serverContent) {
                setIsThinking(false);
                if (!firstTokenEmitted.current) {
                  emitLatency("firstToken", performance.now() - roundTripStartRef.current);
                  firstTokenEmitted.current = true;
                }
              }

              if (msg.toolCall?.functionCalls) {
                const resps = msg.toolCall.functionCalls.map((fc: any) => {
                  if (fc.name === "saveMemory") {
                    addMemory(fc.args.fact);
                    return { id: fc.id, name: fc.name, response: { result: "Saved" } };
                  }
                  if (fc.name === "updateAnalysis") {
                    setAuraState({ words: fc.args.user_words, tone: fc.args.detected_tone, intent: fc.args.perceived_intent });
                    return { id: fc.id, name: fc.name, response: { result: "Logged" } };
                  }
                  return { id: fc.id, name: fc.name, response: { error: "Unknown" } };
                });

                const activeSession = sessionRef.current as any;
                if (activeSession && typeof activeSession.sendToolResponse === "function") {
                  activeSession.sendToolResponse({
                    functionResponses: resps
                  });
                } else if (activeSession) {
                  // Fallback for older SDK versions
                  activeSession.sendClientContent({
                    toolResponse: { functionResponses: resps }
                  });
                }
              }

              if (msg.serverContent?.inputTranscription?.text)
                addTurn(msg.serverContent.inputTranscription.text, true);

              if (msg.serverContent?.modelTurn?.parts) {
                const textPart = msg.serverContent.modelTurn.parts.find((p: any) => p.text);
                if (textPart) addTurn(textPart.text, false);

                const audioPart = msg.serverContent.modelTurn.parts.find((p: any) => p.inlineData?.data);
                if (audioPart) {
                  setIsThinking(false);
                  setIsSpeakingState(true);
                  emitLatency("roundTrip", performance.now() - roundTripStartRef.current);
                  console.log("[AURA] 🔊 Audio data received! Length:", audioPart.inlineData.data.length);
                  const f32 = base64PcmToFloat32(audioPart.inlineData.data);
                  const buf = audioContext.createBuffer(1, f32.length, 24000);
                  buf.getChannelData(0).set(f32);
                  const node = audioContext.createBufferSource();
                  node.buffer = buf;
                  node.connect(outAnalyser);
                  const startAt = Math.max(audioContext.currentTime, nextPlayTimeRef.current);
                  node.start(startAt);
                  activeAudioNodesRef.current.add(node);
                  nextPlayTimeRef.current = startAt + buf.duration;
                  node.onended = () => {
                    activeAudioNodesRef.current.delete(node);
                    if (audioContext.currentTime >= nextPlayTimeRef.current - 0.1) setIsSpeakingState(false);
                  };
                }
              }

              if (msg.serverContent?.turnComplete) {
                lastTurnEndTimeRef.current = performance.now();
                isFirstChunkOfTurnRef.current = true;
              }

              if (msg.serverContent?.interrupted) {
                interruptPlayback(0);
                // Gap 1: Full interruption recovery
                // 1. Pause input briefly so the model finishes processing the interrupt
                isSessionReadyRef.current = false;
                setTimeout(() => {
                  isSessionReadyRef.current = true;
                  // 2. Inject a soft context recovery so the model picks up naturally
                  if (sessionRef.current && sessionState.current === 'connected') {
                    try {
                      (sessionRef.current as any).sendClientContent({
                        turns: [{
                          role: "user",
                          parts: [{ text: "[INTERRUPTION: The user cut you off. This is natural — don't apologize or acknowledge being interrupted. Simply listen for what they want to say. If they stay silent, gently continue from where you were or pivot to what matters now. Never say 'sorry I was interrupted' or 'as I was saying'.]" }]
                        }],
                        turnComplete: false
                      });
                    } catch (e) {
                      console.warn("[AURA] Interruption recovery injection failed:", e);
                    }
                  }
                }, 200);

                (sessionRef.current as any)?.sendClientContent({
                  turns: [{
                    role: "user",
                    parts: [{
                      text: "[INTERRUPTED] You were cut off. Don't acknowledge it. Don't apologize. Just listen to what comes next and respond to that."
                    }]
                  }],
                  turnComplete: false
                });
              }
            },

            onclose: (event: any) => {
              const code: number | undefined = event?.code;
              const reason: string | undefined = event?.reason ?? "";
              console.error(`[AURA] ⚠️ WebSocket CLOSED. Code: ${code ?? "?"}, Reason: "${reason || "none"}", State was: ${sessionState.current}`);
              isSessionReadyRef.current = false;
              if (sessionState.current === 'disconnecting' || userClosedRef.current) return;

              if (isModelRejection(code, reason, "")) {
                sessionState.current = 'error';
                setStatus("error");
                setLastError(`Model rejection: ${reason || "Not supported"}`);
                return;
              }

              // --- FIXED: Reconnect Logic (Problem 3) ---
              if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                sessionState.current = 'error';
                setStatus("error");
                setLastError("Could not maintain connection after multiple attempts.");
                return;
              }

              sessionState.current = 'error';
              setStatus("reconnecting");
              
              reconnectTimerRef.current = setTimeout(() => {
                // The statusRef guard prevents reconnecting after the user has deliberately ended the session
                if (statusRef.current !== "idle" && !userClosedRef.current) {
                  reconnectAttemptsRef.current++;
                  connectSessionRef.current();
                }
              }, 1500); // Wait 1.5s before retry to allow teardown to settle
            },

            onerror: (err: unknown) => {
              const msg =
                err instanceof Error ? err.message
                : typeof err === "string" ? err
                : "Connection error occurred.";
              setLastError(msg);
              if (statusRef.current === "connecting") {
                teardownResources();
                setStatus("idle");
                isStartingRef.current = false;
              }
            },
          }
        });
      } catch (connectErr: any) {
        // ai.live.connect() threw before WS opened (HTTP 400/404 etc.)
        const errMsg = String(connectErr?.message ?? connectErr ?? "");
        if (isModelRejection(undefined, undefined, errMsg)) {
          sessionState.current = 'error';
          setStatus("error");
          setLastError(`Connection rejected: ${errMsg}`);
          return;
        }
        // Not a model issue — real error, bubble up
        throw connectErr;
      }

      sessionRef.current = session;

      // Greeting is now sent inside onopen after 500ms handshake delay (Bug #2 fix)

      // Audio sender — queues up chunks during reconnect, flushes on resume
      const send = (d: Float32Array) => {
        const activeSession = sessionRef.current as any;

        if (!activeSession || sessionState.current !== 'connected' || !isSessionReadyRef.current) {
          if (audioQueue.current.length < MAX_QUEUE) audioQueue.current.push(d);
          else { audioQueue.current.shift(); audioQueue.current.push(d); }
          return;
        }
        if (activeSession.ws && activeSession.ws.readyState !== 1) return;

        // Logging every 100th chunk to avoid spamming while still verifying activity
        if (Math.random() < 0.01) console.log("[AURA] Sending audio chunk...");

        try {
          // Flush queued chunks first
          while (audioQueue.current.length > 0) {
            const chunk = audioQueue.current.shift()!;
            if (isSessionReadyRef.current && sessionRef.current) {
              sessionRef.current.sendRealtimeInput({
                audio: {
                  data: float32ToBase64Pcm(chunk),
                  mimeType: "audio/pcm;rate=16000"
                }
              });
            }
          }

          if (isSessionReadyRef.current && sessionRef.current) {
            sessionRef.current.sendRealtimeInput({
              audio: {
                data: float32ToBase64Pcm(d),
                mimeType: "audio/pcm;rate=16000"
              }
            });
          }
        } catch (err: any) {
          const msg = err?.message ?? "";
          if (msg.includes('CLOSING') || msg.includes('CLOSED') || msg.includes('WebSocket')) return;
        }
      };

      // Prefer AudioWorklet; fall back to ScriptProcessor
      try {
        await audioContext.audioWorklet.addModule(WORKLET_PATH);
        const node = new AudioWorkletNode(audioContext, "pcm-capture-processor", {
          processorOptions: { inputSampleRate: audioContext.sampleRate }
        });
        workletNodeRef.current = node;
        node.port.onmessage = (e) => {
          if (!isSessionReadyRef.current || !sessionRef.current) return;
          const raw = e.data;
          // New processor sends { pcmData: ArrayBuffer }
          const f32 = raw.pcmData ? new Float32Array(raw.pcmData) : (raw instanceof Float32Array ? raw : new Float32Array(raw));
          if (!f32) return;

          // Capture pause duration on first chunk of each new turn
          if (isFirstChunkOfTurnRef.current) {
              pauseSinceLastTurnRef.current = performance.now() - lastTurnEndTimeRef.current;
              isFirstChunkOfTurnRef.current = false;
          }

          const now = performance.now();
          if (lastChunkTime.current) {
            emitLatency("audioChunkInterval", now - lastChunkTime.current);
          }
          lastChunkTime.current = now;
          send(f32);
        };
        inAnalyser.connect(node);
        const silent = audioContext.createGain();
        silent.gain.value = 0;
        node.connect(silent).connect(audioContext.destination);
      } catch {
        const proc = audioContext.createScriptProcessor(512, 1, 1);
        processorRef.current = proc;
        proc.onaudioprocess = (e) =>
          send(resampleFIR(e.inputBuffer.getChannelData(0), audioContext.sampleRate, 16000));
        inAnalyser.connect(proc);
        const silent = audioContext.createGain();
        silent.gain.value = 0;
        proc.connect(silent).connect(audioContext.destination);
      }
    } catch (err: any) {
      clearTimeout(connectTimeoutId);
      sessionState.current = 'error';
      isCascadingRef.current = false;
      setStatus("error");
      throw err;
    }
  }, [teardownResources, addTurn, addMemory, interruptPlayback]);

  // Keep the ref in sync so callbacks always call the latest version
  useEffect(() => { connectSessionRef.current = connectSession; }, [connectSession]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        audioContextRef.current?.state === 'running' && audioContextRef.current.suspend();
      } else {
        audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume();
        if (sessionState.current !== 'error' || userClosedRef.current) return;
        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          connectSessionRef.current();
        }, 300);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const updateConfig = useCallback((newVoice?: string, newMode?: string) => {
    if (!sessionRef.current || sessionState.current !== 'connected') return;
    if (newVoice) voiceRef.current = newVoice;
    if (newMode) modeRef.current = newMode;
    try {
      const configPayload = {
        setup: {
          model: LIVE_MODELS[currentModelIndexRef.current],
          generationConfig: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceRef.current } } },
          },
          systemInstruction: {
            parts: [{ text: getGeminiSystemPrompt(seedRef.current.content ? [seedRef.current.content] : [], modeRef.current) }],
          },
        },
      };
      const s = sessionRef.current as any;
      if (typeof s.send === "function") s.send(configPayload);
      else if (s.ws?.readyState === 1) s.ws.send(JSON.stringify(configPayload));
    } catch (err) {
      console.warn("[AURA] Failed to update session config:", err);
    }
  }, []);

  const startSession = useCallback(async () => {
    if (sessionState.current !== 'idle' || isStartingRef.current) return;
    const userId = await resolveUserId(getCredential("supabase_user_email") || undefined);
    userIdRef.current = userId;
    storageManager.setUserId(userId);
    if (shouldShowSetupPrompt(userId)) { setShowCloudSyncPrompt(true); return; }
    if (!hasRequiredCredentials()) { setShowSettingsModal(true); return; }

    setStatus("requesting");
    setLastError(null);
    isStartingRef.current = true;
    userClosedRef.current = false;

    // Gap 7: Auto-activate late-night mode between 11 PM and 5 AM
    if (isLateNightHour() && modeRef.current === "adaptive") {
      modeRef.current = "latenight";
      console.log("[AURA] 🌙 Late-night mode auto-activated");
    }

    // Always start the cascade from the best model
    currentModelIndexRef.current = 0;
    isCascadingRef.current = false;

    try {
      const seedData = await storageManager.loadSeed();
      seedRef.current.content = seedData?.seed || "";
      if (seedRef.current.content) {
        emitLatency("memoryLayer", "seed");
      } else {
        emitLatency("memoryLayer", "live");
      }

      await connectSession();

      sessionIdRef.current = initSessionId();
      setTranscript([]);

      try {
        const res = await fetch(
          `${ENDPOINTS.sessionStart}?user_id=${userId}&seed=${encodeURIComponent(seedRef.current.content || "")}&device_id=${deviceId}`,
          { method: "POST", headers: { Authorization: `Bearer ${getGeminiKey()}` } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sessionIdRef.current = data.session_id;
        localStorage.setItem("aura_session_v1", data.session_id);

        // Sync canonical seed from Supabase if newer
        if (data.canonical_seed && data.canonical_seed !== seedRef.current.content) {
          seedRef.current.content = data.canonical_seed;
          console.log("[AURA] Seed synced from Supabase");
        }
      } catch {
        backendAvailable.current = false;
      }

    } catch (err) {
      try { teardownResources(); } catch (_) {}
      sessionState.current = 'error';
      isCascadingRef.current = false;
      setStatus("error");
      setLastError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      isStartingRef.current = false;
    }
  }, [connectSession, storageManager, teardownResources]);

  useEffect(() => {
    return () => {
      userClosedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      teardownResources();
    };
  }, [teardownResources]);

  return {
    status,
    isSpeaking,
    isThinking,
    volume,
    isActiveVoice,
    auraState,
    memories,
    lastError,
    warning,
    showSettingsModal,
    setShowSettingsModal,
    showCloudSyncPrompt,
    setShowCloudSyncPrompt,
    getInputFrequencyData,
    getOutputFrequencyData,
    startSession,
    endSession,
    updateConfig,
    backendAvailable,
  };
}