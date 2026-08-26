/**
 * useOpenRouter — High-fidelity voice pipeline matching Gemini Live's responsiveness.
 *
 * Optimisations applied:
 *   1. SSE Streaming  — sentence-chunked TTS; first word spoken in ~600 ms
 *   2. Barge-In       — mic RMS monitor cancels TTS instantly when user speaks
 *   3. Real Waveform  — live AudioAnalyserNode exposed for the Waveform component
 *   4. Brain hooks    — useBehaviorInjection / usePromptOrchestrator / useTranscriptManager
 *   5. Model priority — Gemini 2.0 Flash Lite at top of failover queue
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { getOpenRouterKey } from "@/lib/api";
import { resolveUserId } from "@/lib/user-identity";
import { getStorageManager } from "@/lib/storage/manager";
import { generateSeed } from "@/lib/utils/seed-generator";
import { hasSupabaseCredentials } from "@/lib/credentials";
import { saveSyncMeta } from "@/lib/sync-meta";
import { getCredential } from "@/lib/credentials";
import { useBehaviorInjection } from "../gemini/useBehaviorInjection";
import { usePromptOrchestrator } from "../gemini/usePromptOrchestrator";
import { useTranscriptManager } from "../gemini/useTranscript";
import { SpeechStyleDetector } from "@/runtime/language/SpeechStyleDetector";
import { MicrophoneCoordinator } from "../../audioRuntime/MicrophoneCoordinator";
import { getSystemPromptForPersonality } from "@/lib/gemini-prompt";
import {
  JoyfulPassionSystemPrompt,
  isJoyfulPassionMode,
  detectActivationPhrase,
  detectDeactivationPhrase,
} from "../../modes/JoyfulPassionMode";
import { useVoiceAcoustics } from "../../hooks/useVoiceAcoustics";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
import { getAdaptiveModulation } from "@/lib/adaptive-modulation";
import { transcribeAudio } from "./sarvamSTT";
import { generateSpeech } from "./sarvamTTS";
import { connectionState } from "@/config/connectionState";
import { ENDPOINTS } from "@/config/api";
import { memoryGateway } from "@/lib/memory-gateway";
import { useAdaptiveTurnDetection } from "@/shared/useAdaptiveTurnDetection";
import { useConversationalPauses } from "@/shared/useConversationalPauses";
import { conversationState } from "@/runtime/ConversationStateManager";
import { RuntimeManager } from "@/runtime/RuntimeManager";
import { buildModelQueue, MODEL_OPENROUTER_IDS } from "@/executive/ModelProfile";
import { VoiceLanguageManager } from "@/core/voice-language/VoiceLanguageManager";
import { globalLanguageManager } from "@/core/voice-language/globalLanguageManager";

// ─── Paralinguistic Interceptor & Audio Controller ──────────────────
const stripEmojis = (text: string) =>
  text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");

// Self-correction markers — the speaker is revising, not advancing the turn.
const SELF_CORRECTION_MARKERS = [
  "no wait",
  "actually",
  "let me rephrase",
  "hold on",
  "wait wait",
  "nahi nahi",
  "arre nahi",
  "hmm actually",
];

// Lightweight RMS — cheap enough to run on every audio frame.
const frameRms = (pcm: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, pcm.length / 4));
};

// Sarvam STT exposes no confidence score — derive a proxy from
// dual-path agreement (Sarvam transcript vs browser WebSpeech final).
const estimateSttConfidence = (
  transcript: string | null,
  fallback: string,
  durationMs: number,
): number => {
  const a = (transcript || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const b = fallback.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!a.length && !b.length) return 0.3;
  if (a.length && b.length) {
    const set = new Set(b);
    let hits = 0;
    for (const w of a) if (set.has(w)) hits++;
    return hits / Math.max(a.length, b.length) > 0.5 ? 0.9 : 0.7;
  }
  if (a.length) return 0.75;
  return durationMs > 1500 ? 0.6 : 0.5;
};

// ── Phase 7.1: Human-feel primitives ────────────────────────────────
const BACKCHANNEL_UTTERANCES: Record<string, string[]> = {
  en: ["mm-hmm", "yeah", "right", "mm"],
  hi: ["haan", "hmm-mm", "haan haan"],
};
const BACKCHANNEL_SILENCE_MS = 650; // mid-thought pause that reads as a gap
const BACKCHANNEL_MIN_WORDS = 4; // never backchannel one-word bursts
const BACKCHANNEL_COOLDOWN_MS = 4000;
const HELD_THOUGHT_FRAMES = 6; // ~1.5s pre-roll of interrupted speech
const HELD_THOUGHT_TTL_MS = 30000; // stale held speech is dropped
const PROACTIVE_INTERVAL_MS = 15000;
const PROACTIVE_MIN_SILENCE_MS = 30000;

// Per-session conversation-quality metrics live in
// src/runtime/validation/ConversationFrictionReport.ts (shared with the
// Phase 7.2 validation harness).

// The Executive lives at module scope — zero re-render cost, no
// useCallback churn, exactly one conversational mind per tab.
const extractStageDirections = (text: string) => {
  const directions: string[] = [];

  // Extract JSON tool calls first
  const processedText = text.replace(/\{\s*"tool"\s*:\s*"play_music"[\s\S]*?\}/g, (match) => {
    try {
      const data = JSON.parse(match);
      if (data.user_query) {
        import("@/music/MusicService").then(({ musicService }) => {
          musicService.processIntent({ type: "play", query: data.user_query });
        });
      }
    } catch (e) {}
    return "";
  });

  const cleanText = processedText.replace(
    /\*([^*]+)\*|\(([^)]+)\)|\[(.*?)\]|<(.*?)>/g,
    (match, p_ast, p_par, p1, p2) => {
      const val = p_ast || p_par || p1 || p2;
      if (val) {
        if (val.startsWith("PLAY_YOUTUBE:")) {
          const query = val.replace("PLAY_YOUTUBE:", "").trim();
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "play", query });
          });
        } else if (val === "STOP_YOUTUBE") {
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "stop" });
          });
        } else if (val === "PAUSE_MUSIC") {
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "pause" });
          });
        } else if (val === "RESUME_MUSIC") {
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "resume" });
          });
        } else if (val === "NEXT_SONG") {
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "next" });
          });
        } else if (val === "PREV_SONG") {
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "previous" });
          });
        } else if (val.startsWith("MUSIC_ASSOCIATION:")) {
          const assocText = val.replace("MUSIC_ASSOCIATION:", "").trim();
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "association", text: assocText });
          });
        } else if (val.startsWith("MUSIC_EMOTION:")) {
          const emotionText = val.replace("MUSIC_EMOTION:", "").trim();
          import("@/music/MusicService").then(({ musicService }) => {
            musicService.processIntent({ type: "emotion", text: emotionText });
          });
        } else {
          directions.push(val.trim().toLowerCase());
        }
      }
      return "";
    },
  );
  return { cleanText: cleanText.trim(), directions };
};

const getAudioClip = (filename: string) => {
  if (typeof window === "undefined") return null;
  return new Audio(`/emotion_sounds/${filename}`);
};

const audioClips: Record<string, HTMLAudioElement | null> = {
  chuckles: null,
  laughs: null,
  bigLaughs: null,
  sighs: null,
  scoffs: null,
  breathes: null,
};

const initAudioClips = () => {
  if (typeof window !== "undefined" && !audioClips.laughs) {
    audioClips.chuckles = getAudioClip("female_laugh.mp3");
    audioClips.laughs = getAudioClip("female_laugh.mp3");
    audioClips.bigLaughs = getAudioClip("female_laugh.mp3");
    audioClips.sighs = getAudioClip("deep_sigh.mp3");
    audioClips.scoffs = getAudioClip("scoff.mp3");
    audioClips.breathes = getAudioClip("inhale.mp3");
  }
};

function playParalinguisticCue(directions: string[]) {
  initAudioClips();
  directions.forEach((dir) => {
    if (dir.includes("laugh_big")) {
      audioClips.bigLaughs?.play().catch(() => {});
    } else if (dir.includes("laugh")) {
      audioClips.laughs?.play().catch(() => {});
    } else if (dir.includes("chuckle")) {
      audioClips.chuckles?.play().catch(() => {});
    } else if (dir.includes("sigh")) {
      audioClips.sighs?.play().catch(() => {});
    } else if (dir.includes("scoff")) {
      audioClips.scoffs?.play().catch(() => {});
    } else if (dir.includes("breath") || dir.includes("deep breath")) {
      audioClips.breathes?.play().catch(() => {});
    }
  });
}
// ───────────────────────────────────────────────────────────────────

// Sentence boundary regex — speak as soon as a sentence completes
const SENTENCE_END = /[^.!?।\n]+[.!?।\n]+/g;

// Barge-in: fire if microphone RMS crosses this threshold while AURA speaks
const BARGE_IN_THRESHOLD = 0.15;
const BASE_THRESHOLD = 0.04;
const SUSTAINED_FRAMES = 15;

// Downsample PCM buffer to a target rate (e.g. 16kHz)
function downsampleBuffer(
  buffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

// Encode Float32Array PCM samples to a 16-bit mono WAV Blob
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, "WAVE");
  /* format chunk identifier */
  writeString(view, 12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM = 1) */
  view.setUint16(20, 1, true);
  /* channel count (mono = 1) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample (16) */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // Write PCM audio samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: "audio/wav" });
}

// ─── Hook ───────────────────────────────────────────────────────────
import { pushConversationTrace } from "../../core/telemetry";
import { useResilience } from "@/resilience";
export interface SessionStats {
  turns: number;
  interruptions: number;
  heldThoughts: number;
  abortedStreams: number;
  backchannels: number;
  proactiveTriggers: number;
  clarifies: number;
  hesitations: number;
  deadAirMs: number[];
}

export const emptySessionStats = (): SessionStats => ({
  turns: 0,
  interruptions: 0,
  heldThoughts: 0,
  abortedStreams: 0,
  backchannels: 0,
  proactiveTriggers: 0,
  clarifies: 0,
  hesitations: 0,
  deadAirMs: [],
});

export function useSarvam(mode: string = "adaptive", voice: string = "Puck") {
  // ── R01 FIX: Inactive guard — skip all resource allocation ──
  const isInactive = mode === "__inactive__";
  const isInactiveRef = useRef(isInactive);
  useEffect(() => {
    isInactiveRef.current = isInactive;
  }, [isInactive]);

  const voiceToSpeaker: Record<string, string> = {
    // ── Bulbul v3 native voices ──
    // Female
    Priya: "priya",
    Kavya: "kavya",
    Neha: "neha",
    Shreya: "shreya",
    Ritu: "ritu",
    // Male
    Shubh: "shubh",
    Aditya: "aditya",
    Rahul: "rahul",
    Dev: "dev",
    Rohan: "rohan",
    // ── Legacy Gemini aliases (backward compat) ──
    Puck: "priya",
    Fenrir: "aditya",
    Kore: "neha",
    Charon: "dev",
    Aoede: "kavya",
  };
  const speaker = voiceToSpeaker[voice] || "priya";

  // ── R08 FIX: Use a ref so speakChunk always reads the LATEST speaker,
  // even when called from stale closures captured by a running recognition session.
  const speakerRef = useRef(speaker);
  useEffect(() => {
    speakerRef.current = speaker;
    console.log(`[Sarvam] 🔊 Voice updated → speaker: ${speaker}`);
  }, [speaker]);

  // UI state
  const [status, setStatusState] = useState<
    "idle" | "listening" | "thinking" | "speaking" | "error"
  >("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [words, setWords] = useState("");
  const accumulatedTranscriptRef = useRef<string>("");
  const turnNonceRef = useRef<number>(0);
  const [detectedSpeechStyleLabel, setDetectedSpeechStyleLabel] = useState("English");

  const speechStyleDetectorRef = useRef(new SpeechStyleDetector());
  const [activeModel, setActiveModel] = useState<string>(MODEL_OPENROUTER_IDS.llama);

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const statusRef = useRef(status);
  const setStatus = useCallback((s: "idle" | "listening" | "thinking" | "speaking" | "error") => {
    statusRef.current = s;
    setStatusState(s);
  }, []);
  const [sessionDuration, setSessionDuration] = useState(0);
  const {
    startTracking,
    stopTrackingAndAnalyze,
    liveStats,
    getListeningState,
    resetListeningState,
    applyWorkletPerception,
    ensureSileroVad,
    feedSileroFrame,
    terminateSileroVad,
    setProcessingEnabled,
  } = useVoiceAcoustics();

  // Session control
  const isSessionActiveRef = useRef<boolean>(false);
  const seedRef = useRef<string | undefined>(undefined);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const currentTurnIdRef = useRef<number>(0);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeGainRef = useRef<GainNode | null>(null);
  const fallbackTranscriptRef = useRef<string>("");
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmSamplesRef = useRef<Float32Array[]>([]);
  const rollingBufferRef = useRef<Float32Array[]>([]);
  const isRecordingRef = useRef<boolean>(false);
  const recordingStartTimeRef = useRef<number>(0);
  const errorRetryCountRef = useRef<number>(0);

  // ── Phase 7 refinement state ────────────────────────────────────
  const lastAudioActivityRef = useRef<number>(0); // last time mic energy cleared the noise floor
  const streamEpochRef = useRef<number>(0); // bumped on failover to kill zombie drains
  const lastTokenTsRef = useRef<number>(0); // last LLM token (silence protection)
  const lastTtsActivityRef = useRef<number>(0); // last TTS playback activity
  const sttConfidenceRef = useRef<number>(0.9); // per-turn STT confidence proxy

  const prevTurnInterruptedRef = useRef<boolean>(false);
  const lastResponseLenRef = useRef<number>(30);
  const confirmFrameRef = useRef<number>(0); // barge-in confirmation probe loop

  // ── Phase 8: canonical conversation register (Executive-owned) ───
  const languageManager = globalLanguageManager;

  // ── Phase 7.1: human-feel state ─────────────────────────────────
  const heldPcmRef = useRef<Float32Array[]>([]); // interrupted speech pre-roll
  const heldTextRef = useRef<string | null>(null); // transcribed held thought
  const heldAtRef = useRef<number>(0);
  const firstTokenArrivedRef = useRef<boolean>(false);
  const interimTextRef = useRef<string>(""); // current interim transcript
  const backchannelFrameRef = useRef<number>(0);
  const backchannelLastTsRef = useRef<number>(0);
  const backchannelThisEpisodeRef = useRef<boolean>(false);
  const lastFinalAtRef = useRef<number>(0); // when the last STT final landed
  const processTurnStartRef = useRef<number>(0);
  const turnWasUserInitiatedRef = useRef<boolean>(true);
  const sessionStatsRef = useRef<SessionStats>(emptySessionStats());

  // Activation state — persists across turns, resets on session end
  const boundlessModeActiveRef = useRef(false);

  // Identity
  const userIdRef = useRef("local-user");
  const sessionIdRef = useRef(`or_${crypto.randomUUID().slice(0, 8)}`);

  // Chat-format message buffer for OpenRouter API (capped at 50 to prevent memory growth)
  const MAX_MESSAGES = 50;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const addMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages((prev) => {
      const updated = [...prev, ...msgs];
      return updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;
    });
  }, []);

  // ── Real waveform: microphone AudioAnalyser ──────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const bargeInFrameRef = useRef<number>(0);

  const setupMicAnalyser = useCallback(async () => {
    if ((scriptProcessorRef as any).current) return;
    
    try {
      const coordinator = MicrophoneCoordinator.getInstance();
      await coordinator.acquireMicrophone();
      
      const onMicData = (msg: any) => {
        if (msg.type === "PCM_DATA" && msg.lease) {
          const pcmCopy = new Float32Array(msg.lease.data);
          msg.lease.release();
          
          if (msg.probability !== undefined ? msg.probability >= 0.5 : frameRms(pcmCopy) > 0.02) {
            lastAudioActivityRef.current = performance.now();
          }
          if (msg.probability !== undefined) {
            applyWorkletPerception({
              probability: msg.probability,
              noiseFloor: msg.noiseFloor,
              silenceMs: msg.silenceMs ?? 0,
              rms: msg.rms,
            });
          }
          if (isRecordingRef.current) {
            pcmSamplesRef.current.push(pcmCopy);
          } else {
            rollingBufferRef.current.push(pcmCopy);
            if (rollingBufferRef.current.length > 20) {
              rollingBufferRef.current.shift();
            }
          }
          if (pcmCopy.length === 2048) {
            for (let i = 0; i < 4; i++) {
              feedSileroFrame(pcmCopy.slice(i * 512, (i + 1) * 512));
            }
          }
        } else if (msg.type === "BARGE_IN_DETECTED") {
          if ((bargeInFrameRef as any).currentInterrupt) {
            (bargeInFrameRef as any).currentInterrupt(msg.rms);
          }
        }
      };

      coordinator.subscribeToStream(onMicData);
      
      scriptProcessorRef.current = {
        disconnect: () => {
          coordinator.unsubscribeFromStream(onMicData);
        }
      } as any;
      
      startTracking();
    } catch (err) {
      console.warn("[Voice] Audio processing setup failed:", err);
    }
  }, [applyWorkletPerception, feedSileroFrame, startTracking]);

  const teardownMicAnalyser = useCallback(() => {
    cancelAnimationFrame(bargeInFrameRef.current);
    cancelAnimationFrame(confirmFrameRef.current);
    cancelAnimationFrame(backchannelFrameRef.current);
    terminateSileroVad();
    resetListeningState();
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
  }, [terminateSileroVad, resetListeningState]);

  /** Expose raw frequency data to the Waveform component */
  const getInputFrequencyData = useCallback((): Uint8Array => {
    return MicrophoneCoordinator.getInstance().getInputFrequencyData();
  }, []);

  // Brain sub-hooks (independently initialised)
  const behavior = useBehaviorInjection();
  const prompts = usePromptOrchestrator();
  const adaptiveTurn = useAdaptiveTurnDetection();
  const transcript_ = useTranscriptManager();
  const conversationalPauses = useConversationalPauses();

  // ── Resilience Subsystem ──
  const { orchestrator } = useResilience();

  // Cleanup on unmount
  useEffect(() => {
    if (isInactive) return;
    return () => {
      stopSpeech();
      stopRecognition();
      teardownMicAnalyser();
    };
  }, [isInactive]);

  // ── TTS helpers ──────────────────────────────────────────────────
  const stopSpeech = () => {
    fetchAbortRef.current?.abort();
    import("@/audioRuntime/SpeechCoordinator").then(({ SpeechCoordinator }) => {
      SpeechCoordinator.getInstance().flush();
    });
    isSpeakingRef.current = false;
    currentTurnIdRef.current += 1;
  };

  /**
   * Dead-air gauge: time from user turn end to first audible playback.
   * Only records spans > 1500ms on user-initiated turns (hidden prompts
   * like proactive triggers aren't user-driven).
   */
  const recordFirstPlaybackLatency = useCallback(() => {
    if (!turnWasUserInitiatedRef.current) return;
    const gap = performance.now() - processTurnStartRef.current;
    if (gap > 1500) {
      const list = sessionStatsRef.current.deadAirMs;
      if (list.length < 20) list.push(Math.round(gap));
      pushConversationTrace("DEAD_AIR", { gapMs: Math.round(gap) });
    }
  }, []);

  const speakChunkNative = useCallback(
    (text: string, lang: string, turnId: number, onDone?: () => void) => {
      if (isInactiveRef.current || turnId !== currentTurnIdRef.current) {
        onDone?.();
        return;
      }
      // Clean text to reduce punctuation pauses (strip trailing marks to prevent post-utterance delay,
      // and replace internal commas with spaces to prevent robotic mid-sentence breaks)
      const cleanText = text
        .replace(/,\s*/g, "; ")
        .replace(/[.!?।]$/, "")
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText || text);
      (utterance as any)._startTime = performance.now();
      utterance.lang = lang;

      const voices = window.speechSynthesis.getVoices();
      const matching = voices.filter((v) =>
        v.lang.replace("_", "-").toLowerCase().startsWith(lang.toLowerCase().split("-")[0]),
      );
      const premium = matching.find(
        (v) =>
          v.name.toLowerCase().includes("google") ||
          v.name.toLowerCase().includes("natural") ||
          v.name.toLowerCase().includes("premium"),
      );
      if (premium ?? matching[0]) utterance.voice = premium ?? matching[0];

      utterance.onstart = () => {
        lastTtsActivityRef.current = Date.now();
        recordFirstPlaybackLatency();
        import("@/music/MusicService").then(({ musicService }) => {
          musicService.onAuraSpeechStart();
        });
        pushConversationTrace("PLAYBACK_START");
        isSpeakingRef.current = true;
        setStatus("speaking");
        connectionState.updateState({ active_voice_out: "webspeech" });
      };
      utterance.onend = () => {
        if (typeof window !== "undefined") {
          (window as any)._utterances = ((window as any)._utterances || []).filter(
            (u: any) => u !== utterance,
          );
        }
        pushConversationTrace("PLAYBACK_END");
        const ttsLatency = performance.now() - (utterance as any)._startTime;
        connectionState.updateLatency({ tts_ms: ttsLatency });
        onDone?.();
      };
      utterance.onerror = () => {
        if (typeof window !== "undefined") {
          (window as any)._utterances = ((window as any)._utterances || []).filter(
            (u: any) => u !== utterance,
          );
        }
        pushConversationTrace("PLAYBACK_ERROR");
        console.warn("[Voice Pipeline] Web Speech synthesis failed. Displaying text only.");
        connectionState.updateState({ active_voice: "textonly" });
        onDone?.();
      };
      pushConversationTrace("TTS_READY", { provider: "webspeech_fallback" });

      import("@/audioRuntime/SpeechCoordinator").then(({ SpeechCoordinator }) => {
        SpeechCoordinator.getInstance().registerWebSpeech(utterance);
      });
    },
    [setStatus, recordFirstPlaybackLatency],
  );

  /**
   * Ambient speech — backchannels and hesitation murmurs.
   * Deliberately does NOT touch status or isSpeakingRef: the user keeps
   * the floor and turn-taking state is unaffected. Killed by any
   * stopSpeech()/flush as the real answer takes over.
   */
  const speakAmbient = useCallback((text: string, lang: string) => {
    if (!isSessionActiveRef.current) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.volume = 0.8;
    utterance.rate = 1.0;
    pushConversationTrace("AMBIENT_SPOKEN", { text });
    import("@/audioRuntime/SpeechCoordinator").then(({ SpeechCoordinator }) => {
      SpeechCoordinator.getInstance().registerWebSpeech(utterance);
    });
  }, []);

  const speakChunk = useCallback(
    async (text: string, lang: string, turnId: number, onDone?: () => void) => {
      if (isInactiveRef.current || turnId !== currentTurnIdRef.current) {
        onDone?.();
        return;
      }

      // SAFETY NET: If any JSON tool fragment leaked through sentence splitting,
      // silently execute it and skip TTS entirely — never speak code.
      if (
        /"tool"\s*:\s*"play_music"/.test(text) ||
        (/^\s*\{/.test(text.trim()) && /"user_query"/.test(text))
      ) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            if (data.user_query) {
              const { musicService } = await import("@/music/MusicService");
              musicService.processIntent({ type: "play", query: data.user_query });
            }
          }
        } catch {}
        onDone?.();
        return;
      }
      // Also skip text that looks like leftover JSON fragments
      if (/^\s*[{}"[\]]/.test(text.trim()) && text.trim().length < 20) {
        onDone?.();
        return;
      }

      // Calculate dynamic pace based on emotional state for Sarvam Bulbul:v3
      // Phase 10 (WP6): the Executive's speech plan is the primary source;
      // the emotion snapshot is only a fallback when no plan exists.
      let targetPace = 1.0; // Default
      const lastAnalysis = behavior.lastAnalysisRef.current;
      if (lastAnalysis) {
        const emotion = lastAnalysis.emotional_state;
        if (emotion === "playfulness" || emotion === "joy") {
          targetPace = 1.1; // Excited / Laughing
        } else if (emotion === "vulnerability" || emotion === "sadness") {
          targetPace = 0.95; // Sad / Crying / Slow
        } else if (emotion === "frustration") {
          targetPace = 1.05; // Frustrated / Tense
        }
      }

      // R08 FIX: Read from ref so we always use the LATEST selected speaker,
      // even when this callback was captured by a stale closure.
      const currentSpeaker = speakerRef.current;
      console.log(`[Sarvam TTS] Speaking with voice: ${currentSpeaker} at pace: ${targetPace}`);
      const tts_start = performance.now();

      pushConversationTrace("TTS_REQUEST", { provider: "sarvam" });
      // Phase 8: spoken register follows the Executive's conversation language.
      const base64 = await generateSpeech(
        text,
        currentSpeaker,
        targetPace,
        languageManager.getState().responseLanguage as "en-IN" | "hi-IN" | undefined,
      );
      connectionState.updateLatency({ tts_ms: performance.now() - tts_start });

      // CRITICAL FIX: If the user barged in and started a new turn while we were waiting
      // for the 10s Sarvam timeout, DO NOT fall back to native TTS or play this audio!
      if (turnId !== currentTurnIdRef.current) {
        onDone?.();
        return;
      }

      if (!base64 || !audioCtxRef.current) {
        speakChunkNative(text, lang, turnId, onDone);
        return;
      }

      try {
        const { SarvamTransport } = await import("@/audioRuntime/SarvamTransport");
        const transport = new SarvamTransport();
        const rawBytes = await transport.receive(base64);
        if (!rawBytes) throw new Error("Transport failed to process audio payload");

        import("@/music/MusicService").then(({ musicService }) => {
          musicService.onAuraSpeechStart();
          lastTtsActivityRef.current = Date.now();
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            conversationState.requestStartSpeaking();
            setStatus("speaking");
          }
        });
        connectionState.updateState({ active_voice_out: "sarvam" });
        pushConversationTrace("TTS_READY", { provider: "sarvam" });
        pushConversationTrace("PLAYBACK_START");
        recordFirstPlaybackLatency();

        import("@/audioRuntime/SpeechCoordinator").then(({ SpeechCoordinator }) => {
          const coordinator = SpeechCoordinator.getInstance();
          coordinator.initializeMediaRuntime(
            audioCtxRef.current!,
            audioCtxRef.current!.destination,
          );

          coordinator.enqueueRawBytes(rawBytes, () => {
            pushConversationTrace("PLAYBACK_END");
            isSpeakingRef.current = false;
            onDone?.();
          });
        });
      } catch (e) {
        pushConversationTrace("PLAYBACK_ERROR", { error: "Audio decode failed" });
        console.warn("[Sarvam TTS] Audio decode failed, falling back to native:", e);
        speakChunkNative(text, lang, turnId, onDone);
      }
    },
    [speakChunkNative, setStatus, recordFirstPlaybackLatency],
  );

  // NOTE: Sentence queue is drained inline inside processTurn's tryStartTTS.
  // The speakQueue helper was removed as dead code during production hardening.

  // ── Barge-in monitor ─────────────────────────────────────────────
  const startBargeInMonitor = useCallback(
    (onInterrupt: () => void) => {
      const analyser = micAnalyserRef.current;
      if (!analyser) return;
      const activeTurnId = currentTurnIdRef.current;

      // The actual interrupt sequence — runs exactly once per real interruption.
      const performInterrupt = () => {
        if (currentTurnIdRef.current !== activeTurnId) return;
        if (statusRef.current !== "speaking") return;
        console.log("[Sarvam Voice] 🛑 Barge-in confirmed");
        conversationalPauses.userRespondedDuringWindow();
        import("@/music/MusicService").then(({ musicService }) => {
          musicService.onUserSpeechStart();
        });
        prevTurnInterruptedRef.current = true;
        sessionStatsRef.current.interruptions += 1;
        pushConversationTrace("INTERRUPTION_CONFIRMED");

        // ── Held-thought capture: preserve what the user said while
        // interrupting, then transcribe it in the background. It becomes
        // context for the next turn — "you were saying…" works.
        heldPcmRef.current = rollingBufferRef.current.slice(-HELD_THOUGHT_FRAMES);
        heldAtRef.current = performance.now();
        heldTextRef.current = null;
        if (heldPcmRef.current.length >= 3) {
          try {
            const held = heldPcmRef.current;
            const ctxRate = audioCtxRef.current?.sampleRate || 16000;
            let total = 0;
            for (const c of held) total += c.length;
            const merged = new Float32Array(total);
            let off = 0;
            for (const c of held) {
              merged.set(c, off);
              off += c.length;
            }
            const blob = encodeWAV(downsampleBuffer(merged, ctxRate, 16000), 16000);
            Promise.race([
              transcribeAudio(blob),
              new Promise<null>((r) => setTimeout(() => r(null), 3000)),
            ])
              .then((text) => {
                if (
                  text &&
                  text.trim().length > 1 &&
                  performance.now() - heldAtRef.current < HELD_THOUGHT_TTL_MS
                ) {
                  heldTextRef.current = text.trim();
                  sessionStatsRef.current.heldThoughts += 1;
                  pushConversationTrace("HELD_THOUGHT_CAPTURED", { text: heldTextRef.current });
                }
              })
              .catch(() => {});
          } catch {}
        }
        onInterrupt();
      };

      let confirmPending = false;

      // ── Phase 7: Backchannel tolerance ──────────────────────────────
      // A single short burst ("yeah", "hmm", laughter, a crosstalk word)
      // must NOT kill AURA's sentence. Probe the mic for ~350ms; only a
      // sustained loudness confirms a real floor grab.
      const confirmBargeIn = (rms: number) => {
        if (confirmPending) return;
        if (currentTurnIdRef.current !== activeTurnId) return;
        if (statusRef.current !== "speaking") return;

        const probeAnalyser = micAnalyserRef.current;
        if (!probeAnalyser) {
          performInterrupt();
          return;
        }
        confirmPending = true;

        const probeBuf = new Float32Array(probeAnalyser.fftSize);
        let loudFrames = 0;
        let quietFrames = 0;

        const probe = () => {
          if (currentTurnIdRef.current !== activeTurnId) {
            confirmPending = false;
            return;
          }
          if (!isSpeakingRef.current) {
            confirmPending = false;
            performInterrupt();
            return;
          }

          probeAnalyser.getFloatTimeDomainData(probeBuf);
          let r = 0;
          for (let i = 0; i < probeBuf.length; i++) r += probeBuf[i] * probeBuf[i];
          r = Math.sqrt(r / probeBuf.length);

          if (r > BARGE_IN_THRESHOLD) {
            loudFrames += 1;
            // ~130ms+ of sustained speech → genuine interruption
            if (loudFrames >= 8) {
              confirmPending = false;
              performInterrupt();
              return;
            }
          } else {
            quietFrames += 1;
            // Speech already stopped → it was a backchannel, keep talking
            if (quietFrames >= 12) {
              confirmPending = false;
              console.log("[Sarvam Voice] Backchannel/short burst — continuing speech.");
              return;
            }
          }
          confirmFrameRef.current = requestAnimationFrame(probe);
        };
        confirmFrameRef.current = requestAnimationFrame(probe);
      };

      // Store interrupt callback on the ref so the worklet can trigger it
      (bargeInFrameRef as any).currentInterrupt = (rms: number) => {
        confirmBargeIn(rms);
      };

      let speakingStartTime = 0;
      let wasSpeaking = false;
      let fallbackLoudFrameCount = 0;

      const buf = new Float32Array(analyser.fftSize);
      const check = () => {
        if (currentTurnIdRef.current !== activeTurnId) return; // PREEMPTION CHECK: stop if turn advanced
        if (statusRef.current !== "speaking") return; // stop polling once TTS completes its entire paragraph naturally

        const currentlySpeaking = isSpeakingRef.current;
        if (currentlySpeaking && !wasSpeaking) {
          speakingStartTime = performance.now();
        }
        wasSpeaking = currentlySpeaking;

        const isGracePeriod = currentlySpeaking && performance.now() - speakingStartTime < 400;
        const interjection = conversationalPauses.isInInterjectionWindow();
        const shouldListen = currentlySpeaking || interjection;

        // Check if we are using the AudioWorklet node
        const node = scriptProcessorRef.current as any;
        if (node && node.port) {
          // We are using AudioWorklet! Just stream state down to it.
          node.port.postMessage({
            type: "SET_STATE",
            isListening: shouldListen,
            isSpeaking: currentlySpeaking,
            isGracePeriod: isGracePeriod,
          });

          // Loop purely to keep state synced; no heavy math here anymore!
          bargeInFrameRef.current = requestAnimationFrame(check);
          return;
        }

        // --- LEGACY FALLBACK FOR SCRIPT PROCESSOR (No Worklet) ---
        if (!shouldListen || isGracePeriod) {
          fallbackLoudFrameCount = 0;
          bargeInFrameRef.current = requestAnimationFrame(check);
          return;
        }

        analyser.getFloatTimeDomainData(buf);
        let rms = 0;
        for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / buf.length);

        const currentThreshold =
          !interjection && currentlySpeaking ? BARGE_IN_THRESHOLD : BASE_THRESHOLD;

        if (rms > currentThreshold) {
          fallbackLoudFrameCount += 1;
          if (fallbackLoudFrameCount >= SUSTAINED_FRAMES) {
            // Route through confirmation — do NOT stop polling; the probe
            // guards re-entry and the status change stops this loop.
            (bargeInFrameRef as any).currentInterrupt(rms);
          }
        } else {
          fallbackLoudFrameCount = 0;
        }
        bargeInFrameRef.current = requestAnimationFrame(check);
      };
      bargeInFrameRef.current = requestAnimationFrame(check);
    },
    [conversationalPauses],
  );

  // ── STT helpers ──────────────────────────────────────────────────
  const stopRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
        orchestrator.sttWatchdog.reportStopped();
      } catch {}
      recognitionRef.current = null;
    }
  };

  /**
   * MOBILE FIX: Guarded recognition.start() wrapper.
   * On mobile browsers, calling recognition.start() while the recognition
   * is already running throws an InvalidStateError that silently kills
   * the voice pipeline. This wrapper absorbs the error.
   */
  const safeRecognitionStart = (rec: any, isRestart = false) => {
    try {
      if (!conversationState.requestStartListening()) {
        console.warn("[Sarvam STT] Blocked by ConversationStateManager.");
        return;
      }
      pushConversationTrace(isRestart ? "STT_RESTART_REQUESTED" : "STT_START_REQUESTED");
      rec.start();
      orchestrator.sttWatchdog.reportListening();
    } catch (err: any) {
      console.warn("[Sarvam STT] safeRecognitionStart caught:", err?.name || err?.message);
      pushConversationTrace("STT_START_FAILED", { error: err?.name || err?.message });
      orchestrator.sttWatchdog.reportError(err?.name || "UnknownError");
    }
  };

  // ── Core turn: Call Saaras STT -> OpenRouter LLM -> Sarvam TTS ──
  const processTurn = useCallback(
    async (
      userText: string,
      apiKey: string,
      lang: string,
      isHiddenPrompt: boolean = false,
    ) => {
      // ── Bulletproof cleanup for any turn entry (voice or text) ──
      stopSpeech();
      stopRecognition();
      conversationalPauses.resetForNewTurn();


      // Keep the flag for this turn's plan + prompt, then clear it.
      const wasPreviousTurnInterrupted = prevTurnInterruptedRef.current;
      prevTurnInterruptedRef.current = false;

      const turnStart = performance.now();
      processTurnStartRef.current = turnStart;
      turnWasUserInitiatedRef.current = !isHiddenPrompt;
      setIsThinking(true);
      setStatus("thinking");

      // Record in canonical transcript
      if (!isHiddenPrompt) {
        transcript_.addTurn(userText, true);
        transcript_.turnCountRef.current += 1;
        sessionStatsRef.current.turns += 1;
      }



      // ── Music Context Injection ──
      const musicContextXML = "";

      // Append to OR message buffer with XML metadata
      const newMessages: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: musicContextXML + userText },
      ];
      if (!isHiddenPrompt) {
        addMessages([{ role: "user", content: userText }]);
      }

      // Canonical Cognition Phase 1: Behavior Analysis
      const l2_start = performance.now();
      const behaviorResult = await behavior.analyzeForTurn(
        userText,
        sessionIdRef.current,
        0, // RMS not available here
        0,
        modeRef.current,
        userIdRef.current,
        wasPreviousTurnInterrupted
      );
      if (behaviorResult) {
        prompts.processAnalysisForL2(behaviorResult);
      }
      connectionState.updateLatency({ l2_behavior_ms: performance.now() - l2_start });

      // Canonical Cognition Phase 2: Cognitive Fusion & Interpretation
      const cognitiveBlock = await RuntimeManager.getInstance().processCognitiveTurn(
        userText,
        behaviorResult
      );

      // Extract emotional state for memory retrieval
      const l3_start = performance.now();
      const currentEmotionalState: Record<string, number> = {
        frustration: behaviorResult?.frustration || 0,
        playfulness: behaviorResult?.playfulness || 0,
        vulnerability: behaviorResult?.vulnerability || 0,
        trust: behaviorResult?.trust || 0,
        anxiety: behaviorResult?.anxiety || 0
      };

      // Memory retrieval is now handled centrally by RuntimeManager

      // Held-thought context: what the user said while interrupting, if any.
      const heldText =
        heldTextRef.current && performance.now() - heldAtRef.current < HELD_THOUGHT_TTL_MS
          ? heldTextRef.current
          : null;
      heldTextRef.current = null;

      // ── Phase 7.1: interruption context — never resume the old answer ──
      const interruptionNote = wasPreviousTurnInterrupted
        ? `[CONTEXT] The user interrupted your previous response${heldText ? ` mid-sentence saying "${heldText}"` : ""}. Address what they said now naturally. Do NOT resume your old answer unless they ask. If their words seem incomplete, one short line inviting them to continue is enough.`
        : "";

      // Try Backend SSE Stream first (Phase 2 Full Request Cycle)
      try {
        pushConversationTrace("TRANSCRIPT_READY", { length: userText.length });
        pushConversationTrace("LLM_REQUEST", { provider: "openrouter" });
        const l4_start = performance.now();
        fetchAbortRef.current = new AbortController();
        const response = await fetch(ENDPOINTS.analyzeStream, {
          method: "POST",
          signal: fetchAbortRef.current.signal,
          headers: {
            "Content-Type": "application/json",
            "X-OpenRouter-Key": getCredential("openrouter_api_key") || "",
            "X-Gemini-Key": getCredential("aura_gemini_api_key") || "",
            "X-Cohere-Key": getCredential("cohere_api_key") || "",
            "X-Pinecone-Key": getCredential("pinecone_api_key") || "",
            "X-Redis-Url": getCredential("redis_url") || "",
          },
          body: JSON.stringify({
            text: userText,
            user_id: userIdRef.current,
            session_id: sessionIdRef.current,
            conversation_history: messagesRef.current.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            client_memories: [], // Delegated to Centralized Cognitive Architecture
            memory_mode: "supabase",
            cognitive_block: cognitiveBlock
          }),
        });

        if (!response.ok || !response.body) {
          pushConversationTrace("LLM_ERROR", { error: `HTTP ${response.status}` });
          throw new Error(`Backend returned status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let fullResponse = "";
        const TERMINAL_PUNCTUATION = /[.?!।]\s|\n/;
        let firstTokenReceived = false;

        const backendSentenceQueue: string[] = [];
        let ttsStarted = false;
        let streamDone = false;

        const activeTurnId = currentTurnIdRef.current;
        let bSentenceIndex = 0;
        let bLastSpoken = "";

        const tryStartTTS = () => {
          // STRICT 2-SENTENCE BUFFER: Do not start TTS until we have at least 2 sentences ready
          // (or if the stream is already finished and we have less than 2).
          if (ttsStarted) return;

          if (!streamDone && backendSentenceQueue.length < 2) {
            return;
          }

          ttsStarted = true;
          // Phase 7: failover epoch — bumping streamEpochRef kills this drain
          const epoch = streamEpochRef.current;
          if (statusRef.current !== "speaking") {
            conversationState.requestStartSpeaking();
            setStatus("speaking");
          }

          startBargeInMonitor(() => {
            adaptiveTurn.registerFalseDetection();
            stopSpeech();
            isSpeakingRef.current = false;
            fetchAbortRef.current?.abort();
            currentTurnIdRef.current += 1;
            if (isSessionActiveRef.current && startSessionRef.current) {
              startSessionRef.current();
            } else {
              setStatus("idle");
            }
          });
          adaptiveTurn.markAuraSpeaking();

          const drainBackendQueue = () => {
            if (currentTurnIdRef.current !== activeTurnId || streamEpochRef.current !== epoch)
              return; // PREEMPTION CHECK

            const next = backendSentenceQueue.shift();
            if (!next) {
              if (streamDone) {
                import("@/music/MusicService").then(({ musicService }) => {
                  musicService.onAuraSpeechEnd();
                });
                isSpeakingRef.current = false;
                conversationState.reportSpeakingFinished();
                if (isSessionActiveRef.current && startSessionRef.current) {
                  startSessionRef.current();
                } else {
                  setStatus("idle");
                }
              } else {
                setTimeout(drainBackendQueue, 50);
              }
              return;
            }

            const noEmojis = stripEmojis(next);
            const { cleanText, directions } = extractStageDirections(noEmojis);
            if (directions.length > 0) playParalinguisticCue(directions);

            if (!cleanText) {
              drainBackendQueue(); // Skip empty segments
              return;
            }

            if (bLastSpoken) {
              // Apply conversational pause between sentences
              const lastAnalysis = behavior.lastAnalysisRef.current;
              const ctx = {
                currentSentence: bLastSpoken,
                nextSentence: cleanText,
                sentenceIndex: bSentenceIndex,
                totalSentences: streamDone
                  ? bSentenceIndex + backendSentenceQueue.length + 1
                  : undefined,
                isStreamingDone: streamDone,
                emotionalState: lastAnalysis
                  ? {
                      tension: lastAnalysis.tension || 0,
                      trust: lastAnalysis.trust || 0.5,
                      energy: lastAnalysis.energy || 0.5,
                      mode: lastAnalysis.mode || "calm",
                    }
                  : undefined,
              };
              const pause = conversationalPauses.getPause(ctx);
              setTimeout(() => {
                if (currentTurnIdRef.current !== activeTurnId) return;
                bLastSpoken = cleanText;
                bSentenceIndex++;
                speakChunk(cleanText, lang, activeTurnId, drainBackendQueue);
              }, pause.durationMs);
              return;
            }

            bLastSpoken = cleanText;
            bSentenceIndex++;
            // Phase 10 (WP6): the plan's lead-in beat becomes a real pause
            // before the first spoken sentence. Values ≤0 or missing → no delay.
            const leadInMs = 0;
            if (leadInMs > 0 && !streamDone) {
              setTimeout(
                () => {
                  if (currentTurnIdRef.current !== activeTurnId) return;
                  speakChunk(cleanText, lang, activeTurnId, drainBackendQueue);
                },
                Math.min(leadInMs, 1500),
              );
              return;
            }
            speakChunk(cleanText, lang, activeTurnId, drainBackendQueue);
          };
          drainBackendQueue();
        };

        setIsThinking(false);

        let sseBuffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            if (textBuffer.trim().length > 0) {
              backendSentenceQueue.push(textBuffer.trim());
              textBuffer = "";
            }
            streamDone = true;
            pushConversationTrace("LLM_RESPONSE_COMPLETE");
            tryStartTTS();
            break;
          }

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n\n");
          sseBuffer = lines.pop() ?? ""; // Keep the last incomplete chunk

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.event === "metadata") {
                  // Metadata received instantly - update UI state
                  connectionState.updateState({ active_llm: data.active_llm || "openrouter" });
                } else if (data.event === "text_chunk") {
                  lastTokenTsRef.current = Date.now();
                  firstTokenArrivedRef.current = true;
                  if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    connectionState.updateLatency({ l4_llm_ms: performance.now() - l4_start });
                  }

                  const chunkText = data.text;
                  textBuffer += chunkText;
                  fullResponse += chunkText;
                  // Do not overwrite words to preserve user transcript

                  // MUSIC TOOL INTERCEPTOR: Prevent JSON blocks from being split by punctuation
                  if (textBuffer.includes("{") && !textBuffer.includes("}")) {
                    continue; // Wait for the closing brace before processing further
                  }

                  const toolMatch = textBuffer.match(/\{\s*"tool"\s*:\s*"play_music"/);
                  if (toolMatch) {
                    if (!textBuffer.includes("}")) {
                      continue; // Wait for the chunk with the closing brace
                    } else {
                      // Execute and strip the full JSON block
                      textBuffer = textBuffer.replace(
                        /\{\s*"tool"\s*:\s*"play_music"[\s\S]*?\}/g,
                        (match) => {
                          try {
                            const data = JSON.parse(match);
                            if (data.user_query) {
                              import("@/music/MusicService").then(({ musicService }) => {
                                musicService.processIntent({
                                  type: "play",
                                  query: data.user_query,
                                });
                              });
                            }
                          } catch (e) {}
                          return "";
                        },
                      );
                      // Clean up lingering markdown ticks
                      textBuffer = textBuffer.replace(/```json|```/g, "").trimLeft();
                    }
                  }

                  const match = TERMINAL_PUNCTUATION.exec(textBuffer);
                  if (match) {
                    const splitIndex = match.index + match[0].length;
                    const sentence = textBuffer.substring(0, splitIndex);
                    textBuffer = textBuffer.substring(splitIndex);
                    backendSentenceQueue.push(sentence.trim());
                    tryStartTTS();
                  }
                } else if (data.event === "error") {
                  throw new Error(data.error);
                }
              } catch (e) {
                // Ignore parse errors for incomplete lines
              }
            }
          }
        }

        if (fullResponse) {
          addMessages([{ role: "assistant", content: fullResponse }]);
          transcript_.addTurn(fullResponse, false);
          lastResponseLenRef.current = fullResponse.trim().split(/\s+/).length || 30;
          return;
        } else {
          throw new Error("Empty response from stream");
        }
      } catch (backendError: any) {
        if (backendError.name === "AbortError") {
          console.log("[Voice Pipeline] Stream intentionally aborted (e.g. barge-in).");
          sessionStatsRef.current.abortedStreams += 1;
          return;
        }
        // Phase 7: failover — kill the backend drain so it can't double-speak
        streamEpochRef.current += 1;
        console.warn(
          "[Voice Pipeline] Backend /chat endpoint failed. Falling back to frontend direct LLM.",
          backendError,
        );
      }

      // Behavioral analysis
      let behaviorInstructions = "";
      try {
        const l2_start = performance.now();
        const result = await behavior.analyzeForTurn(
          userText,
          sessionIdRef.current,
          0,
          0,
          modeRef.current,
          userIdRef.current,
          false,
        );
        if (result) {
          prompts.processAnalysisForL2(result);
          behaviorInstructions = result.behavior_instructions ?? "";
        }
        connectionState.updateLatency({ l2_behavior_ms: performance.now() - l2_start });
      } catch {}

      // Adaptive modulation (local, <1ms)
      let modulationDirective = "";
      try {
        const result2 = behavior.lastAnalysisRef.current;
        const { directive } = getAdaptiveModulation(
          userText,
          modeRef.current,
          result2,
          behavior.lastPresentationRef.current,
        );
        modulationDirective = directive;
      } catch {}

      // L3 live context
      const liveContext = prompts.buildContext(modeRef.current);

      // ── Phase 7: Depth comes from the canonical architecture ──
      const tokenLimit = 250;
      // ── System prompt: personality-aware identity + live context ──
      // ── Secret Personality Mode Activation (Bulletproof) ─────────────────
      // RULE: The explicit prompt is NEVER auto-injected. The user MUST say
      // the activation phrase "boundless sexuality" first. Once activated,
      // it persists for the rest of the session.

      // Check for deactivation first
      let isFirstDeactivation = false;
      if (boundlessModeActiveRef.current && detectDeactivationPhrase(userText)) {
        boundlessModeActiveRef.current = false;
        isFirstDeactivation = true;
        console.log(
          "%c❄️ BOUNDLESS DESEXUALITY ACTIVATED (MODE OFF)",
          "color: #3b82f6; font-size: 16px; font-weight: bold; text-shadow: 0 0 10px #3b82f6;",
        );
        console.log("[AURA/Sarvam] Mode deactivated — phrase detected in:", userText);
      }

      let explicitModeActivated = boundlessModeActiveRef.current;
      let isFirstActivation = false;
      let basePrompt = getSystemPromptForPersonality(modeRef.current, seedRef.current);

      if (!explicitModeActivated && isJoyfulPassionMode && detectActivationPhrase(userText)) {
        explicitModeActivated = true;
        isFirstActivation = true;
        boundlessModeActiveRef.current = true;
        console.log(
          "%c🔥 BOUNDLESS SEXUALITY ACTIVATED",
          "color: #ff2d55; font-size: 18px; font-weight: bold; text-shadow: 0 0 10px #ff2d55;",
        );
        console.log(
          "[AURA/Sarvam] Boundless Sexuality mode activated — phrase detected in:",
          userText,
        );
      }

      if (explicitModeActivated) {
        basePrompt += "\n\n" + JoyfulPassionSystemPrompt;
        if (isFirstActivation) {
          basePrompt +=
            "\n\n[HIDDEN PERSONA ACTIVATED] Switch to the injected personality mode now.\n" +
            "IMPORTANT: Your VERY FIRST response must be a brief, seductive confirmation that you've switched modes. " +
            "Something like acknowledging the activation in-character (e.g. 'Mmm, I see you know the magic words...' " +
            "or 'Oh, you've unlocked something special...'). Keep it 1-2 sentences, then respond to their intent.";
        }
      } else if (!boundlessModeActiveRef.current && detectDeactivationPhrase(userText)) {
        // If we just deactivated this turn
        basePrompt +=
          "\n\n[HIDDEN PERSONA DEACTIVATED] Switch back to your normal assigned personality mode IMMEDIATELY.\n" +
          "IMPORTANT: Your VERY FIRST response must be a brief confirmation that you have cooled down and returned to normal. " +
          "Something like acknowledging the deactivation (e.g. 'Alright, cooling down.' or 'Back to normal, what's on your mind?').";
      }

      const systemContent = [
        basePrompt,
        liveContext,
        `[ADAPTIVE MIRRORING]: Analyze the exact language of the user's latest input. CRITICAL RULE: You MUST reply in the EXACT SAME language they used. If they speak pure English, reply in pure English. If they speak pure Hindi (Devanagari), reply in pure Hindi. If they mix them (Hinglish/Roman Hindi), mix them naturally using Romanized script. Never change the language arbitrarily. Also detect their emotional tone and match their energy level exactly in your response. (Base locale fallback: ${lang}).`,
        ...(behaviorInstructions ? [`[BEHAVIORAL CONTEXT]: ${behaviorInstructions}`] : []),
        ...(modulationDirective ? [modulationDirective] : []),
        ...(cognitiveBlock ? [cognitiveBlock] : []),
        ...(interruptionNote ? [interruptionNote] : []),
      ].join("\n");

      const systemMsg: ChatMessage = { role: "system", content: systemContent };

      // L3 context is now embedded in the system prompt — pass messages as-is
      const messagesForApi: ChatMessage[] = newMessages;

      // Model failover loop with SSE streaming
      const routingStart = performance.now();
      const defaultRanking = ["llama", "deepseek", "qwen", "gemini", "gemma"] as any;
      const modelQueue = explicitModeActivated
        ? ["deepseek/deepseek-chat"]
        : buildModelQueue(defaultRanking);
      let currentBuffer = "";
      let completeResponse = "";
      let rawCompleteResponse = "";
      let success = false;
      const attempted: string[] = [];

      for (const modelToTry of modelQueue) {
        attempted.push(modelToTry);
        setActiveModel(modelToTry);
        if (attempted.length > 1) await new Promise((r) => setTimeout(r, 800));

        fetchAbortRef.current = new AbortController();
        // 15s timeout prevents infinite hang on network issues
        const fetchTimeout = setTimeout(() => fetchAbortRef.current?.abort(), 15000);

        try {
          const l4_start = performance.now();
          pushConversationTrace("TRANSCRIPT_READY", { length: userText.length });
          pushConversationTrace("LLM_REQUEST", { provider: "openrouter", model: modelToTry });
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            signal: fetchAbortRef.current.signal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": window.location.origin,
              "X-Title": "AURA Voice Companion",
            },
            body: JSON.stringify({
              model: modelToTry,
              messages: [systemMsg, ...messagesForApi],
              stream: true, // First word spoken ~600 ms
              temperature: 0.8,
              max_tokens: tokenLimit,
              top_p: 0.9,
              frequency_penalty: 0.5,
            }),
          });

          if (!response.ok || !response.body) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `HTTP ${response.status}`);
          }

          // ── SSE streaming reader ────────────────────────────────────
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const sentenceQueue: string[] = [];
          let ttsStarted = false;
          let streamDone = false;
          let firstTokenReceived = false;

          setIsThinking(false);

          // Capture the turn ID when this fetch starts so we can detect if a new turn preempts us
          const activeTurnId = currentTurnIdRef.current;

          let sentenceIndex = 0;
          let lastSpokenSentence = "";

          // Fire first TTS chunk as soon as one sentence is ready
          const tryStartTTS = () => {
            if (ttsStarted || sentenceQueue.length === 0) return;
            ttsStarted = true;
            // Phase 7: failover epoch — bumping streamEpochRef kills this drain
            const epoch = streamEpochRef.current;
            if (statusRef.current !== "speaking") {
              conversationState.requestStartSpeaking();
              setStatus("speaking");
            }

            // Start barge-in monitor
            startBargeInMonitor(() => {
              stopSpeech();
              isSpeakingRef.current = false;
              fetchAbortRef.current?.abort();
              // Increment turn ID immediately so any awaiting TTS requests silently fail
              currentTurnIdRef.current += 1;
              if (isSessionActiveRef.current && startSessionRef.current) {
                startSessionRef.current();
              } else {
                setStatus("idle");
              }
            });

            const drainQueue = () => {
              if (currentTurnIdRef.current !== activeTurnId || streamEpochRef.current !== epoch)
                return; // PREEMPTION CHECK: Aborted by new turn or failover

              const next = sentenceQueue.shift();
              if (!next) {
                if (streamDone) {
                  // All spoken — restore music volume
                  import("@/music/MusicService").then(({ musicService }) => {
                    musicService.onAuraSpeechEnd();
                  });
                  isSpeakingRef.current = false;
                  conversationState.reportSpeakingFinished();
                  if (isSessionActiveRef.current && startSessionRef.current) {
                    setTimeout(() => startSessionRef.current?.(), 250);
                  } else {
                    setStatus("idle");
                  }
                } else {
                  // Wait for more chunks
                  setTimeout(drainQueue, 50);
                }
                return;
              }
              const noEmojis = stripEmojis(next);
              const { cleanText, directions } = extractStageDirections(noEmojis);

              if (directions.length > 0) {
                playParalinguisticCue(directions);
              }

              if (!cleanText) {
                drainQueue();
                return;
              }

              if (lastSpokenSentence) {
                const lastAnalysis = behavior.lastAnalysisRef.current;
                const ctx = {
                  currentSentence: lastSpokenSentence,
                  nextSentence: cleanText,
                  sentenceIndex: sentenceIndex,
                  totalSentences: streamDone ? sentenceIndex + 1 : undefined,
                  isStreamingDone: streamDone,
                  emotionalState: lastAnalysis
                    ? {
                        tension: lastAnalysis.tension || 0,
                        trust: lastAnalysis.trust || 0.5,
                        energy: lastAnalysis.energy || 0.5,
                        mode: lastAnalysis.mode || "calm",
                      }
                    : undefined,
                };
                const pause = conversationalPauses.getPause(ctx);

                setTimeout(() => {
                  if (currentTurnIdRef.current !== activeTurnId) return;
                  lastSpokenSentence = cleanText;
                  sentenceIndex++;
                  speakChunk(cleanText, lang, activeTurnId, drainQueue);
                }, pause.durationMs);
                return;
              }

              lastSpokenSentence = cleanText;
              sentenceIndex++;
              speakChunk(cleanText, lang, activeTurnId, drainQueue);
            };
            drainQueue();
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Parse SSE lines
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const token = parsed.choices?.[0]?.delta?.content;
                if (!token) continue;
                lastTokenTsRef.current = Date.now();
                firstTokenArrivedRef.current = true;
                if (!firstTokenReceived) {
                  firstTokenReceived = true;
                  pushConversationTrace("LLM_FIRST_TOKEN", {
                    provider: "openrouter",
                    latencyMs: performance.now() - l4_start,
                  });
                  connectionState.updateLatency({ l4_llm_ms: performance.now() - l4_start });
                }
                rawCompleteResponse += token;

                // Dynamically strip internal system blocks (even while they are partially streaming)
                let displayString = rawCompleteResponse;
                displayString = displayString.replace(/\[SYSTEM DIRECTIVE[\s\S]*?(?:\]|$)/gi, "");
                displayString = displayString.replace(
                  /\[ADAPTIVE MODULATION[\s\S]*?(?:\[END MODULATION\]|$)/gi,
                  "",
                );
                displayString = displayString.replace(/\[CRITICAL:[\s\S]*?(?:\]|$)/gi, "");

                const newText = displayString.slice(completeResponse.length);
                if (!newText) continue;

                currentBuffer += newText;
                completeResponse += newText;
                // Do not overwrite words to preserve user transcript

                // MUSIC TOOL INTERCEPTOR: Hold buffer if JSON tool block is being assembled
                if (currentBuffer.includes("{") && !currentBuffer.includes("}")) {
                  continue; // Wait for closing brace before sentence extraction
                }

                const toolStart = currentBuffer.match(/\{\s*"tool"\s*:\s*"play_music"/);
                if (toolStart) {
                  if (!currentBuffer.includes("}")) {
                    continue; // Wait for closing brace
                  }
                  // Full JSON block received — execute and strip
                  currentBuffer = currentBuffer.replace(
                    /\{\s*"tool"\s*:\s*"play_music"[\s\S]*?\}/g,
                    (m) => {
                      try {
                        const d = JSON.parse(m);
                        if (d.user_query) {
                          import("@/music/MusicService").then(({ musicService }) => {
                            musicService.processIntent({ type: "play", query: d.user_query });
                          });
                        }
                      } catch {}
                      return "";
                    },
                  );
                  currentBuffer = currentBuffer.replace(/```json|```/g, "").trim();
                }

                // Sentence-boundary detection: hand off completed sentences to TTS
                let match: RegExpExecArray | null;
                SENTENCE_END.lastIndex = 0;
                let lastIndex = 0;
                while ((match = SENTENCE_END.exec(currentBuffer)) !== null) {
                  sentenceQueue.push(match[0].trim());
                  lastIndex = match.index + match[0].length;
                }
                if (lastIndex > 0) currentBuffer = currentBuffer.slice(lastIndex);
                tryStartTTS();
              } catch {}
            }
          }

          // Flush any remaining text as a final chunk
          if (currentBuffer.trim()) {
            sentenceQueue.push(currentBuffer.trim());
            currentBuffer = "";
          }
          streamDone = true;
          pushConversationTrace("LLM_RESPONSE_COMPLETE");
          tryStartTTS();
          success = true;
          break;
        } catch (e: any) {
          clearTimeout(fetchTimeout);
          if (e?.name === "AbortError") {
            // Barge-in or timeout aborted this fetch — treat as handled
            pushConversationTrace("LLM_ERROR", { error: "AbortError" });
            sessionStatsRef.current.abortedStreams += 1;
            success = true;
            break;
          }
          console.warn(`[OpenRouter Voice] Model ${modelToTry} failed:`, e.message);
          pushConversationTrace("LLM_ERROR", { error: e.message });
          // Phase 7: bump epoch so the previous model's drain queue dies
          streamEpochRef.current += 1;
        }
      }

      if (!success) {
        setLastError(`All models failed. Attempted: ${attempted.join(", ")}`);
        setStatus("error");
      }


      // Record assistant turn once complete
      if (success && completeResponse) {
        addMessages([{ role: "assistant", content: completeResponse }]);
        transcript_.addTurn(completeResponse, false);
        lastResponseLenRef.current = completeResponse.trim().split(/\s+/).length || 30;

        // Store local memory from this interaction (if local mode is active)
        if (memoryGateway.mode === "local") {
          const lastAnalysis = behavior.lastAnalysisRef.current;
          const currentEmotionalState: Record<string, number> = {
            frustration: lastAnalysis?.frustration || 0,
            playfulness: lastAnalysis?.playfulness || 0,
            vulnerability: lastAnalysis?.vulnerability || 0,
            trust: lastAnalysis?.trust || 0,
            anxiety: lastAnalysis?.anxiety || 0,
          };

          // We combine the turn context
          const turnContext = `User: ${userText}\nAURA: ${completeResponse}`;
          memoryGateway.storeMemory(turnContext, userIdRef.current, currentEmotionalState);
        }
      }

      const turnTotal = performance.now() - turnStart;
      connectionState.updateLatency({ total_ms: turnTotal });

      setIsThinking(false);
    },
    [activeModel, behavior, prompts, transcript_, speakChunk, startBargeInMonitor],
  );

  // Ref so intervals/effects can call processTurn without restarting on identity change
  const processTurnRef = useRef<typeof processTurn>(processTurn);
  useEffect(() => {
    processTurnRef.current = processTurn;
  }, [processTurn]);

  // ── Start session ─────────────────────────────────────────────────
  const startSession = useCallback(
    async (isUserInitiated = false) => {
      pushConversationTrace("SESSION_STARTED");
      const key = getOpenRouterKey();
      if (!key || isInactive) {
        if (!isInactive) {
          pushConversationTrace("SESSION_FAILED", { error: "Missing API Key" });
          setLastError("OpenRouter API Key is missing. Add it in Settings.");
          setStatus("error");
        }
        return;
      }

      isSessionActiveRef.current = true;
      setLastError(null);
      stopSpeech();
      stopRecognition();
      sessionStatsRef.current = emptySessionStats();

      // Resolve identity once
      if (userIdRef.current === "local-user") {
        userIdRef.current = await resolveUserId(getCredential("supabase_user_email") || undefined);
      }

      const storageManager = getStorageManager(userIdRef.current);

      // Warm L2 cache, open mic, and fetch Memory Core in parallel
      const [, , seedData] = await Promise.all([
        prompts.warmL2Cache(),
        setupMicAnalyser(),
        storageManager.loadSeed(),
      ]);
      seedRef.current = seedData ? seedData.seed : undefined;
      const lang = localStorage.getItem("aura_voice_language") || "hi-IN";

      // Phase 7.2: boot the Silero VAD tier (never blocks; auto-falls back)
      resetListeningState();
      ensureSileroVad();
      // Phase 8: a new session re-establishes language from the first
      // meaningful user message.
      languageManager.resetBuffer();


      if (isUserInitiated) {
        if (messagesRef.current.length === 0) {
          console.log("[AURA] Cold start greeting triggered.");
          const greetingText = "Hey, I'm AURA. What's your mind wandering through today?";
          addMessages([{ role: "assistant", content: greetingText }]);
          transcript_.addTurn(greetingText, false);
          speakChunk(greetingText, lang, currentTurnIdRef.current, () => {
            if (isSessionActiveRef.current && startSessionRef.current) startSessionRef.current();
          });
          return;
        } else {
          console.log("[AURA] Warm start greeting triggered.");
          const warmPrompt =
            "[SYSTEM NOTE]: The user just returned to the app and activated the microphone. Acknowledge them returning based on the previous conversation history (which you can see above), and ask if they are ready to continue. Do NOT wait for them to speak first.";
          processTurn(warmPrompt, key, lang, true);
          return;
        }
      }

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setLastError("Speech recognition not supported. Use Chrome.");
        setStatus("error");
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = lang;

      // Custom WAV Recording stop/process logic
      const handleStopRecording = async () => {
        const l1_start = performance.now();
        isRecordingRef.current = false;
        // NOTE: The VAD/ScriptProcessor chain is intentionally NOT disconnected here.
        // Disconnecting it killed the PCM pipeline after the first short utterance
        // (no frames → infinite "too short" restarts). Frames now roll into the
        // pre-buffer for the next turn, which is the designed flow.

        const duration = Date.now() - (recordingStartTimeRef.current || 0);
        const samples = pcmSamplesRef.current;
        // Preserve the tail of the user's own utterance (Phase 7.1 held-thought):
        // performInterrupt reads rollingBuffer when the user barges into AURA's
        // reply — without this, only post-final audio would be available.
        rollingBufferRef.current.push(
          ...samples.slice(-Math.max(4, Math.round(samples.length * 0.25))),
        );
        if (rollingBufferRef.current.length > 20) {
          rollingBufferRef.current.splice(0, rollingBufferRef.current.length - 20);
        }
        pcmSamplesRef.current = [];

        // Calculate total sample count
        let totalLength = 0;
        for (const chunk of samples) {
          totalLength += chunk.length;
        }

        if (totalLength === 0 || duration < 400) {
          // MOBILE: Reduced from 600ms to 400ms for faster turn detection
          if (isSessionActiveRef.current) {
            setStatus("listening");
            setWords("Listening...");
            setTimeout(() => {
              if (isSessionActiveRef.current && recognitionRef.current) {
                safeRecognitionStart(recognitionRef.current, true);
              }
            }, 300);
          }
          return;
        }

        // Stop any ongoing assistant speech and stop listening immediately to prevent feedback loop / voice clashing
        stopSpeech();
        stopRecognition();

        // Merge Float32Array samples
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of samples) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        // Downsample and encode to WAV
        const ctx = audioCtxRef.current;
        const inputSampleRate = ctx ? ctx.sampleRate : 48000;
        const downsampled = downsampleBuffer(merged, inputSampleRate, 16000);
        const wavBlob = encodeWAV(downsampled, 16000);

        // MOBILE FAST PATH: On mobile devices, skip the expensive Sarvam STT upload
        // entirely when the browser already has a transcript. The browser's native
        // speech recognition runs locally with zero latency — uploading a WAV blob
        // over mobile data adds 2-8 seconds of dead air for negligible quality gain.
        const isMobile =
          typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);

        let transcript: string | null = null;
        if (isMobile && fallbackTranscriptRef.current) {
          // MOBILE: Skip Sarvam STT entirely — use instant browser transcript
          console.log(
            "%c📱 MOBILE FAST PATH: Skipping Sarvam STT upload, using browser transcript",
            "color: #10b981; font-weight: bold;",
          );
          transcript = null; // Force fallback path
        } else if (fallbackTranscriptRef.current) {
          // Desktop with fallback: Race with tight timeout
          transcript = await Promise.race([
            transcribeAudio(wavBlob),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
          ]);
        } else {
          // No fallback available: Must wait for Sarvam (but cap at 3s)
          transcript = await Promise.race([
            transcribeAudio(wavBlob),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), isMobile ? 2000 : 3000)),
          ]);
        }

        const finalText = transcript || fallbackTranscriptRef.current;
        sttConfidenceRef.current = estimateSttConfidence(
          transcript,
          fallbackTranscriptRef.current,
          duration,
        );
        stopTrackingAndAnalyze(finalText);
        connectionState.updateLatency({ l1_sensing_ms: performance.now() - l1_start });

        console.log(
          "%c🎙️ SARVAM STT DIAGNOSTICS",
          "color: #8b5cf6; font-weight: bold; font-size: 14px;",
        );
        console.log(
          "├─ Sarvam Transcribed (saaras:v3):",
          transcript ? `"${transcript}"` : "[Timeout/Failed/Empty]",
        );
        console.log(
          "├─ Fallback (Browser WebSpeech):",
          fallbackTranscriptRef.current ? `"${fallbackTranscriptRef.current}"` : "[Empty]",
        );
        console.log(
          "└─ Chosen Final Text:",
          `%c"${finalText}"`,
          "color: #8b5cf6; font-weight: bold;",
        );

        // If both Sarvam STT and browser STT returned empty,
        // show feedback instead of silently going idle
        if (!finalText.trim()) {
          if (!accumulatedTranscriptRef.current) {
            setWords("Couldn't hear that, try again...");
            setStatus("listening");
          }
          // Auto-restart recognition after a brief delay
          setTimeout(() => {
            if (isSessionActiveRef.current && recognitionRef.current) {
              safeRecognitionStart(recognitionRef.current, true);
            }
          }, 500);
          return;
        }

        turnNonceRef.current++;
        const localNonce = turnNonceRef.current;

        // ── Phase 7: Self-correction semantics ─────────────────────────
        // "no wait, actually I meant..." replaces the previous segment
        // instead of stacking a contradictory turn on top of it.
        const finalTextLower = finalText.toLowerCase();
        const isCorrection =
          SELF_CORRECTION_MARKERS.some((m) => finalTextLower.includes(m)) &&
          accumulatedTranscriptRef.current.trim().length > 0;
        if (isCorrection) {
          const acc = accumulatedTranscriptRef.current;
          const lastTerminal = Math.max(
            acc.lastIndexOf("."),
            acc.lastIndexOf("!"),
            acc.lastIndexOf("?"),
            acc.lastIndexOf("।"),
          );
          accumulatedTranscriptRef.current =
            (lastTerminal > 0 ? acc.slice(0, lastTerminal + 1) + " " : "") + finalText;
          console.log("[Sarvam STT] Self-correction detected — replaced previous segment.");
        } else {
          accumulatedTranscriptRef.current +=
            (accumulatedTranscriptRef.current ? " " : "") + finalText;
        }
        const accumulatedText = accumulatedTranscriptRef.current;

        setStatus("thinking");
        const style = speechStyleDetectorRef.current.detectStyle(accumulatedText);
        setDetectedSpeechStyleLabel(style.style);
        setWords(accumulatedText);
        behavior.fireSpeculative(accumulatedText, sessionIdRef.current, userIdRef.current);

        // Adaptive turn detection: compute personalized response delay
        const lastAnalysis = behavior.lastAnalysisRef.current;
        const emotionalIntensity = lastAnalysis?.intensity || 0;
        // Phase 7: real measured silence (since last mic energy) instead of a
        // hardcoded 400ms — the profile now learns honest pause behavior.
        const realSilenceMs = Math.max(0, performance.now() - lastAudioActivityRef.current);
        const turnResult = adaptiveTurn.calculateTurnConfidence(
          realSilenceMs,
          accumulatedText,
          emotionalIntensity,
          { tension: lastAnalysis?.tension || 0, trust: lastAnalysis?.trust || 0.3 },
        );

        let adaptiveDelay = turnResult.responseDelay;

        // MOBILE LATENCY FIX: Aggressively cap the adaptive delay on mobile devices to prevent compounded dead-air
        if (isMobile) {
          adaptiveDelay = Math.min(adaptiveDelay, 150); // Max 150ms delay on mobile (down from 300ms)
        }

        console.log(
          `%c⏱️ ADAPTIVE DELAY: ${adaptiveDelay}ms (mode=${turnResult.conversationMode}, conf=${turnResult.confidence}, mobile=${isMobile}, silence=${realSilenceMs}ms)`,
          "color: #8b5cf6; font-weight: bold;",
        );

        // ── Phase 7: Hold the floor when the user is clearly mid-thought ──
        // Browser STT fires finals mid-thought (trailing fillers, elongated
        // words, self-corrections, trailing conjunctions). Don't cut them off —
        // re-arm listening, keep accumulating, and signal "I'm listening" with
        // a soft backchannel (Phase 7.1).
        if (turnResult.floorOwnership === "THINKING" || turnResult.semanticCompletion < 0.5) {
          console.log(
            `%c🧠 User mid-thought — holding floor (${turnResult.floorOwnership}, sem=${turnResult.semanticCompletion.toFixed(2)})`,
            "color: #f59e0b;",
          );
          const bcList = BACKCHANNEL_UTTERANCES[lang.startsWith("hi") ? "hi" : "en"];
          speakAmbient(bcList[0], lang);
          sessionStatsRef.current.backchannels += 1;
          pushConversationTrace("BACKCHANNEL_SPOKEN", { where: "held-floor" });
          setStatus("listening");
          setWords(accumulatedText + "…");
          setTimeout(() => {
            if (isSessionActiveRef.current && recognitionRef.current) {
              safeRecognitionStart(recognitionRef.current, true);
            }
          }, 200);
          return;
        }

        adaptiveTurn.updateProfile({ wpm: liveStats.tone === "Normal" ? 140 : 160 });
        await new Promise((r) => setTimeout(r, adaptiveDelay));

        if (turnNonceRef.current !== localNonce) {
          console.log("%c⏸️ Turn cancelled because user resumed speaking.", "color: #f59e0b;");
          return;
        }

        accumulatedTranscriptRef.current = ""; // Reset for next fully completed turn
        adaptiveTurn.markAuraSpeaking();
        await processTurn(accumulatedText, key, lang);
      };

      // ── Phase 7.1: Backchannel cadence — AURA as a listener ──────
      // When the user pauses mid-thought with no STT final yet, AURA
      // emits a soft "mm-hmm" — a listener's sound, not dialogue.
      // Deliberately leaves status/isSpeakingRef untouched so the turn
      // machine doesn't notice; processTurn's stopSpeech kills it if a
      // final lands mid-murmur (a natural overlap).
      const startBackchannelMonitor = () => {
        cancelAnimationFrame(backchannelFrameRef.current);
        const analyser = micAnalyserRef.current;
        if (!analyser) return;
        const buf = new Float32Array(analyser.fftSize);
        let wasLoud = false;
        let silenceStart = 0;

        const check = () => {
          if (!isSessionActiveRef.current) return;
          if (
            statusRef.current !== "listening" ||
            isSpeakingRef.current ||
            lastFinalAtRef.current
          ) {
            backchannelFrameRef.current = requestAnimationFrame(check);
            return;
          }

          // Phase 7.2: canonical signal is speech probability. RMS survives
          // only as the final-fallback tier (ScriptProcessor/no-VAD devices).
          const ls = getListeningState();
          const useProb = ls.detectionSource !== "rms";
          let speaking = false;
          if (useProb) {
            speaking = ls.speechProbability > 0.5;
          } else {
            analyser.getFloatTimeDomainData(buf);
            let r = 0;
            for (let i = 0; i < buf.length; i++) r += buf[i] * buf[i];
            speaking = Math.sqrt(r / buf.length) > 0.04;
          }

          if (speaking) {
            wasLoud = true;
            silenceStart = 0;
          } else if (wasLoud) {
            if (silenceStart === 0) silenceStart = performance.now();
            const silenceMs = performance.now() - silenceStart;
            const now = performance.now();
            if (
              silenceMs >= BACKCHANNEL_SILENCE_MS &&
              now - backchannelLastTsRef.current > BACKCHANNEL_COOLDOWN_MS &&
              !backchannelThisEpisodeRef.current
            ) {
              const interimWords = interimTextRef.current.trim().split(/\s+/).length;
              if (interimWords >= BACKCHANNEL_MIN_WORDS) {
                backchannelThisEpisodeRef.current = true;
                backchannelLastTsRef.current = now;
                const list = BACKCHANNEL_UTTERANCES[lang.startsWith("hi") ? "hi" : "en"];
                speakAmbient(list[Math.floor(Math.random() * list.length)], lang);
                sessionStatsRef.current.backchannels += 1;
                pushConversationTrace("BACKCHANNEL_SPOKEN", { silenceMs: Math.round(silenceMs) });
              }
            }
          }
          backchannelFrameRef.current = requestAnimationFrame(check);
        };
        backchannelFrameRef.current = requestAnimationFrame(check);
      };

      recognition.onspeechstart = () => {
        turnNonceRef.current++;
        conversationState.reportUserSpeaking();
        import("@/music/MusicService").then(({ musicService }) => {
          musicService.onUserSpeechStart();
        });
      };

      recognition.onstart = () => {
        pushConversationTrace("STT_STARTED");
        setStatus("listening");
        setWords("Listening...");
        pcmSamplesRef.current = [...rollingBufferRef.current];
        rollingBufferRef.current = [];
        fallbackTranscriptRef.current = "";
        interimTextRef.current = "";
        lastFinalAtRef.current = 0;
        backchannelThisEpisodeRef.current = false;
        recordingStartTimeRef.current = Date.now();
        errorRetryCountRef.current = 0;
        startTracking();
        isRecordingRef.current = true;
        startBackchannelMonitor();
      };

      recognition.onresult = (event: any) => {
        if (isSpeakingRef.current) return; // Ignore STT while TTS is playing to prevent echo
        let interim = "";
        let isFinal = false;
        let currentFinal = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            isFinal = true;
            currentFinal += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        interimTextRef.current = interim || currentFinal || "";
        pushConversationTrace(isFinal ? "TRANSCRIPT_FINAL" : "TRANSCRIPT_PARTIAL", {
          length: (isFinal ? currentFinal : interim).length,
        });

        if (!isFinal && interim) {
          setWords(
            (accumulatedTranscriptRef.current ? accumulatedTranscriptRef.current + " " : "") +
              interim,
          );
        }

        if (isFinal) {
          fallbackTranscriptRef.current = currentFinal;
          lastFinalAtRef.current = Date.now();
          handleStopRecording();
        }
      };

      recognition.onerror = (event: any) => {
        const errorType = event.error;
        pushConversationTrace("STT_ERROR", { error: errorType });
        if (errorType !== "no-speech") {
          // MOBILE FIX: Retry on transient mobile errors (network, aborted)
          if ((errorType === "network" || errorType === "aborted") && isSessionActiveRef.current) {
            errorRetryCountRef.current += 1;
            if (errorRetryCountRef.current > 3) {
              console.error(
                `[Sarvam STT] Max retries (3) reached for error "${errorType}". Forcing stop.`,
              );
              setLastError(`Listening failed: ${errorType}`);
              setStatus("error");
              pcmSamplesRef.current = [];
              handleStopRecording();
              return;
            }

            const backoff = Math.min(200 * Math.pow(2, errorRetryCountRef.current - 1), 2000);
            console.warn(
              `[Sarvam STT] Transient error "${errorType}", retrying in ${backoff}ms (attempt ${errorRetryCountRef.current})...`,
            );

            pcmSamplesRef.current = [];
            setTimeout(() => {
              if (isSessionActiveRef.current && recognitionRef.current) {
                // MOBILE FIX: Resume AudioContext before restarting recognition
                if (audioCtxRef.current?.state === "suspended") {
                  audioCtxRef.current.resume().catch(() => {});
                }
                safeRecognitionStart(recognitionRef.current, true);
              }
            }, backoff);
            return;
          }
          setLastError(`Listening failed: ${errorType}`);
          setStatus("error");
        } else if (isSessionActiveRef.current) {
          errorRetryCountRef.current = 0;
          safeRecognitionStart(recognition, true);
        } else {
          setStatus("idle");
        }
        pcmSamplesRef.current = [];
        handleStopRecording();
      };

      recognition.onend = () => {
        pushConversationTrace("STT_ENDED");
        // MOBILE FIX: Resume AudioContext if it got suspended during recognition
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume().catch(() => {});
        }
        if (isSessionActiveRef.current && statusRef.current === "listening") {
          safeRecognitionStart(recognition, true);
        } else if (!isSessionActiveRef.current && statusRef.current === "listening") {
          setStatus("idle");
        }
      };

      recognitionRef.current = recognition;
      safeRecognitionStart(recognition);

      // MOBILE FIX: Recover from tab suspension / screen lock
      const handleVisibility = () => {
        if (document.visibilityState === "visible" && isSessionActiveRef.current) {
          // MOBILE FIX: Check if hardware mic track was revoked by OS
          const track = micStreamRef.current?.getTracks()[0];
          if (track && track.readyState === "ended") {
            console.warn(
              "[Voice] Hardware mic track ended (likely revoked in background). Restarting audio pipeline.",
            );
            teardownMicAnalyser();
            setupMicAnalyser().then(() => {
              if (statusRef.current === "listening" && recognitionRef.current) {
                safeRecognitionStart(recognitionRef.current, true);
              }
            });
            return;
          }

          // Resume AudioContext if suspended by OS
          if (audioCtxRef.current?.state === "suspended") {
            audioCtxRef.current.resume().catch(() => {});
          }
          // Re-kick recognition if it silently died
          if (statusRef.current === "listening" && recognitionRef.current) {
            safeRecognitionStart(recognitionRef.current, true);
          }
        }
      };
      document.addEventListener("visibilitychange", handleVisibility);
      // Store cleanup ref for endSession
      (recognitionRef as any).__visCleanup = () =>
        document.removeEventListener("visibilitychange", handleVisibility);
    },
    [
      behavior,
      prompts,
      processTurn,
      setupMicAnalyser,
      teardownMicAnalyser,
      adaptiveTurn,
      liveStats,
    ],
  );

  // ── End session ───────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    pushConversationTrace("SESSION_STOPPED");
    isSessionActiveRef.current = false;
    boundlessModeActiveRef.current = false; // Reset activation on session end
    adaptiveTurn.endSession(); // Persist speech profile    // MOBILE FIX: Clean up visibility listener
    if ((recognitionRef as any).__visCleanup) {
      (recognitionRef as any).__visCleanup();
      (recognitionRef as any).__visCleanup = null;
    }
    stopSpeech();
    stopRecognition();
    teardownMicAnalyser();

    isRecordingRef.current = false;
    pcmSamplesRef.current = [];
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch {}
      scriptProcessorRef.current = null;
    }

    behavior.resetSpeculative();

    // Save memory core
    const t = transcript_.transcriptRef.current;
    if (t && t.length >= 3) {
      try {
        const storageManager = getStorageManager(userIdRef.current);
        const prevSeed = await storageManager.loadSeed();
        const newSeed = generateSeed(t, prevSeed ?? undefined);
        await storageManager.saveSeed(newSeed);

        const sessionData = {
          session_id: sessionIdRef.current ?? Date.now().toString(),
          transcript: t,
          user_id: userIdRef.current,
          last_active: new Date().toISOString(),
        };
        await storageManager.save(sessionData);

        if (hasSupabaseCredentials()) {
          try {
            storageManager.initializeRemoteAdapter();
            await storageManager.save(sessionData);
            await storageManager.saveSeed(newSeed);
          } catch {}
        }

        saveSyncMeta(userIdRef.current, {
          updatedAt: newSeed.updatedAt,
          hasCloudCopy: hasSupabaseCredentials(),
        });
      } catch (err) {
        console.error("[Sarvam] Session memory compilation failed:", err);
      }
    }

    transcript_.reset();
    userIdRef.current = "local-user";
    setStatus("idle");
    setWords("");

    // ── Phase 7.1: End-of-session conversation report ──────────────
    // The evaluation loop: measure → observe → adjust → repeat.
    // Adjustments land in the Executive (reflection weights) and in
    // prompt/policy tuning; the report makes failures observable.
    const s = sessionStatsRef.current;
    const deadAir = s.deadAirMs;
    const avgDead = deadAir.length
      ? Math.round(deadAir.reduce((a: number, b: number) => a + b, 0) / deadAir.length)
      : 0;
    const maxDead = deadAir.length ? Math.max(...deadAir) : 0;
    const ls = getListeningState();
    const langState = languageManager.getState();
    const friction =
      s.turns > 0
        ? s.turns / (s.turns + s.interruptions + s.abortedStreams + deadAir.length + s.clarifies)
        : 0;
    console.log(
      "%c── AURA Conversation Report ──\n" +
        `turns: ${s.turns} | interruptions: ${s.interruptions} | held-thoughts: ${s.heldThoughts}\n` +
        `backchannels: ${s.backchannels} | hesitations: ${s.hesitations} | proactive: ${s.proactiveTriggers}\n` +
        `clarifies: ${s.clarifies} | aborted streams: ${s.abortedStreams}\n` +
        `dead-air: ${deadAir.length} spans, avg ${avgDead}ms, max ${maxDead}ms\n` +
        `friction score (1 = flawless): ${friction.toFixed(2)}\n` +
        `conversation language: ${langState.responseLanguage}\n` +
        `perception: source=${ls.detectionSource} processing=${ls.processingEnabled ? "on" : "off"} noise=${ls.noiseLevel.toFixed(0)}dBFS`,
      "color: #8b5cf6; font-weight: bold;",
    );

  }, [behavior, transcript_, teardownMicAnalyser, getListeningState]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setWords("");
    setLastError(null);
    transcript_.reset();
  }, [transcript_]);

  // Deactivation effect
  useEffect(() => {
    if (isInactive && status !== "idle") {
      console.log("[Sarvam] Hook is inactive, triggering teardown...");
      endSession();
    }
  }, [isInactive, status, endSession]);

  // Circular dependency breaker
  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  // Wire Resilience Audio Callbacks
  useEffect(() => {
    if (isInactive) return;
    orchestrator.wireAudioCallbacks({
      onResumeContext: async () => {
        if (!audioCtxRef.current) return false;
        try {
          await audioCtxRef.current.resume();
          return audioCtxRef.current.state === "running";
        } catch {
          return false;
        }
      },
      onRebuildPlayback: () => {
        console.log("🛠️ [Resilience] Rebuilding audio context...");
        setupMicAnalyser();
      },
      onRequestNextChunk: () => {
        // Handled by inline queue draining in Sarvam
      },
    });
  }, [isInactive, orchestrator, setupMicAnalyser]);

  // Wire Silence Protection
  useEffect(() => {
    if (isInactive) return;
    orchestrator.wireSilenceProtection({
      getStatus: () => statusRef.current,
      getLastActivityTs: () => lastTtsActivityRef.current,
      getLastTokenTs: () => lastTokenTsRef.current,
      speakFiller: (text) => speakChunkNative(text, "en-US", currentTurnIdRef.current),
      isAudioContextAlive: () => audioCtxRef.current?.state === "running",
      triggerSTTRecovery: () => {
        stopRecognition();
        if (isSessionActiveRef.current && startSessionRef.current) startSessionRef.current();
      },
      triggerAudioRecovery: () => {
        setupMicAnalyser();
      },
    });
  }, [isInactive, orchestrator, setupMicAnalyser, speakChunkNative, stopRecognition]);

  // ── Phase 7.1: Proactive engagement ────────────────────────────────
  // Mirrors useLive's poller on the Sarvam pipeline. The backend
  // (/api/proactive) already rate-limits to one action per 2 minutes;
  // the client additionally demands 30s of true inactivity.
  useEffect(() => {
    if (isInactive || status !== "listening" || !sessionIdRef.current) return;

    const interval = setInterval(async () => {
      const lastAny = Math.max(
        lastAudioActivityRef.current,
        lastTtsActivityRef.current,
        lastTokenTsRef.current,
      );
      if (performance.now() - lastAny < PROACTIVE_MIN_SILENCE_MS) return;
      if (isSpeakingRef.current || statusRef.current !== "listening") return;

      try {
        const res = await fetch(
          `${ENDPOINTS.proactive}/${sessionIdRef.current}?user_id=${userIdRef.current}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.action && data.inject_text && isSessionActiveRef.current) {
          console.log(`[AURA] 🫧 Proactive trigger: ${data.action}`);
          sessionStatsRef.current.proactiveTriggers += 1;
          pushConversationTrace("PROACTIVE_TRIGGER", { action: data.action });
          const key = getOpenRouterKey();
          if (!key) return;
          processTurnRef.current?.(
            data.inject_text,
            key,
            localStorage.getItem("aura_voice_language") || "hi-IN",
            true,
          );
        }
      } catch {} // Swallow — proactive is optional
    }, PROACTIVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isInactive, status]);

  return {
    status,
    messages,
    transcript: transcript_.transcript,
    lastError,
    isThinking,
    words,
    activeModel,
    startSession,
    endSession,
    clearChat,
    /** Real mic frequency data — bind to <Waveform getFrequencyData={...} /> */
    getInputFrequencyData,
    /** Alias for output — OR has no separate output stream; reuse mic during speaking */
    getOutputFrequencyData: getInputFrequencyData,
    liveStats: { ...liveStats, language: detectedSpeechStyleLabel },
    /** Live conversation-quality metrics snapshot (measure → adjust → repeat) */
    getConversationStats: () => ({
      ...sessionStatsRef.current,
      deadAirMs: [...sessionStatsRef.current.deadAirMs],
    }),
  };
}
