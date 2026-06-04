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

import { useState, useRef, useCallback, useEffect } from "react";
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

// ─── Paralinguistic Interceptor & Audio Controller ──────────────────
const stripEmojis = (text: string) => text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');

const extractStageDirections = (text: string) => {
    const directions: string[] = [];
    
    // Extract JSON tool calls first
    let processedText = text.replace(/\{\s*"tool"\s*:\s*"play_music"[\s\S]*?\}/g, (match) => {
        try {
            const data = JSON.parse(match);
            if (data.user_query) {
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "play", query: data.user_query });
                });
            }
        } catch(e) {}
        return "";
    });

    const cleanText = processedText.replace(/\*([^*]+)\*|\(([^)]+)\)|\[(.*?)\]|<(.*?)>/g, (match, p_ast, p_par, p1, p2) => {
        const val = p_ast || p_par || p1 || p2;
        if (val) {
            if (val.startsWith("PLAY_YOUTUBE:")) {
                const query = val.replace("PLAY_YOUTUBE:", "").trim();
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "play", query });
                });
            } else if (val === "STOP_YOUTUBE") {
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "stop" });
                });
            } else if (val === "PAUSE_MUSIC") {
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "pause" });
                });
            } else if (val === "RESUME_MUSIC") {
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "resume" });
                });
            } else if (val === "NEXT_SONG") {
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "next" });
                });
            } else if (val === "PREV_SONG") {
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "previous" });
                });
            } else if (val.startsWith("MUSIC_ASSOCIATION:")) {
                const assocText = val.replace("MUSIC_ASSOCIATION:", "").trim();
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "association", text: assocText });
                });
            } else if (val.startsWith("MUSIC_EMOTION:")) {
                const emotionText = val.replace("MUSIC_EMOTION:", "").trim();
                import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().processIntent({ type: "emotion", text: emotionText });
                });
            } else {
                directions.push(val.trim().toLowerCase());
            }
        }
        return ''; 
    });
    return { cleanText: cleanText.trim(), directions };
};

const getAudioClip = (filename: string) => {
    if (typeof window === 'undefined') return null;
    return new Audio(`/emotion_sounds/${filename}`);
};

const audioClips: Record<string, HTMLAudioElement | null> = {
    chuckles: null,
    laughs: null,
    bigLaughs: null,
    sighs: null,
    scoffs: null,
    breathes: null
};

const initAudioClips = () => {
    if (typeof window !== 'undefined' && !audioClips.laughs) {
        audioClips.chuckles = getAudioClip('female_laugh.mp3');
        audioClips.laughs = getAudioClip('female_laugh.mp3');
        audioClips.bigLaughs = getAudioClip('female_laugh.mp3');
        audioClips.sighs = getAudioClip('deep_sigh.mp3');
        audioClips.scoffs = getAudioClip('scoff.mp3');
        audioClips.breathes = getAudioClip('inhale.mp3');
    }
};

function playParalinguisticCue(directions: string[]) {
    initAudioClips();
    directions.forEach(dir => {
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

// ─── Model queue ────────────────────────────────────────────────────
// DeepSeek V3 first: bypassing Gemini's safety filters for chaotic personality
export const FALLBACK_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-lite-001",
  "google/gemma-3-27b-it",
  "openrouter/free",
  "google/gemma-4-26b-a4b-it:free",
] as const;

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
  const [activeModel, setActiveModel] = useState<string>(FALLBACK_MODELS[0]);

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
  const { startTracking, stopTrackingAndAnalyze, liveStats } = useVoiceAcoustics();

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
    if (micAnalyserRef.current) return; // already open
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });
      micStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;

      // MOBILE FIX: Auto-resume suspended AudioContext (iOS/Android policy)
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }
      // MOBILE FIX: Android Chrome requires a user gesture to unlock AudioContext.
      // Listen for the first touch/click to force-resume if still suspended.
      const unlockAudio = () => {
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume().catch(() => {});
        }
        document.removeEventListener("touchstart", unlockAudio);
        document.removeEventListener("click", unlockAudio);
      };
      document.addEventListener("touchstart", unlockAudio, { once: true });
      document.addEventListener("click", unlockAudio, { once: true });

      const src = ctx.createMediaStreamSource(stream);

      // High-pass filter (removes low rumble/hum/AC fan)
      const highPass = ctx.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 80;

      // Low-pass filter (removes high frequency noise like typing)
      const lowPass = ctx.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 8000;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;

      // Chain the filters: Source -> HPF -> LPF -> Analyser
      src.connect(highPass).connect(lowPass).connect(analyser);

      const sp = ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const clone = new Float32Array(input);
        if (isRecordingRef.current) {
          pcmSamplesRef.current.push(clone);
        } else {
          rollingBufferRef.current.push(clone);
          if (rollingBufferRef.current.length > 20) { // Keep ~1.5s of pre-buffer
            rollingBufferRef.current.shift();
          }
        }
      };
      analyser.connect(sp);
      sp.connect(ctx.destination);
      scriptProcessorRef.current = sp;

      micAnalyserRef.current = analyser;
    } catch {
      console.warn("[OpenRouter Voice] Could not open mic analyser.");
    }
  }, []);

  const teardownMicAnalyser = useCallback(() => {
    cancelAnimationFrame(bargeInFrameRef.current);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    micAnalyserRef.current = null;
  }, []);

  /** Expose raw frequency data to the Waveform component */
  const getInputFrequencyData = useCallback((): Uint8Array => {
    const analyser = micAnalyserRef.current;
    if (!analyser) return new Uint8Array(32);
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    return data;
  }, []);

  // Brain sub-hooks (independently initialised)
  const behavior = useBehaviorInjection();
  const prompts = usePromptOrchestrator();
  const adaptiveTurn = useAdaptiveTurnDetection();
  const transcript_ = useTranscriptManager();
  const conversationalPauses = useConversationalPauses();

  // Cleanup on unmount
  useEffect(() => {
    if (isInactive) return;
    return () => {
      stopSpeech();
      stopRecognition();
      teardownMicAnalyser();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInactive]);

  // ── TTS helpers ──────────────────────────────────────────────────
  const stopSpeech = () => {
    fetchAbortRef.current?.abort();
    if (activeSourceRef.current && activeGainRef.current && audioCtxRef.current) {
      try {
        const now = audioCtxRef.current.currentTime;
        // Audio Ducking: Ramp down volume over 150ms instead of hard cut
        activeGainRef.current.gain.setValueAtTime(activeGainRef.current.gain.value, now);
        activeGainRef.current.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        activeSourceRef.current.stop(now + 0.15);
      } catch {}
      // We don't disconnect immediately, let the ducking finish
      setTimeout(() => {
        if (activeSourceRef.current) {
          activeSourceRef.current.disconnect();
          activeSourceRef.current = null;
        }
        if (activeGainRef.current) {
          activeGainRef.current.disconnect();
          activeGainRef.current = null;
        }
      }, 200);
    } else if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch {}
      activeSourceRef.current.disconnect();
      activeSourceRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
    currentTurnIdRef.current += 1;
  };

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
        import("@/music/MusicManager").then(({ MusicManager }) => {
          MusicManager.getInstance().onAuraSpeechStart();
        });
        pushConversationTrace("PLAYBACK_START");
        isSpeakingRef.current = true;
        setStatus("speaking");
        connectionState.updateState({ active_voice_out: "webspeech" });
      };
      utterance.onend = () => {
        if (typeof window !== "undefined") {
          (window as any)._utterances = ((window as any)._utterances || []).filter((u: any) => u !== utterance);
        }
        pushConversationTrace("PLAYBACK_END");
        const ttsLatency = performance.now() - (utterance as any)._startTime;
        connectionState.updateLatency({ tts_ms: ttsLatency });
        onDone?.();
      };
      utterance.onerror = () => {
        if (typeof window !== "undefined") {
          (window as any)._utterances = ((window as any)._utterances || []).filter((u: any) => u !== utterance);
        }
        pushConversationTrace("PLAYBACK_ERROR");
        console.warn("[Voice Pipeline] Web Speech synthesis failed. Displaying text only.");
        connectionState.updateState({ active_voice: "textonly" });
        onDone?.();
      };
      pushConversationTrace("TTS_READY", { provider: "webspeech_fallback" });
      
      if (typeof window !== "undefined") {
        (window as any)._utterances = (window as any)._utterances || [];
        (window as any)._utterances.push(utterance);
      }
      window.speechSynthesis.speak(utterance);
    },
    [setStatus],
  );

  const speakChunk = useCallback(
    async (text: string, lang: string, turnId: number, onDone?: () => void) => {
      if (isInactiveRef.current || turnId !== currentTurnIdRef.current) {
        onDone?.();
        return;
      }

      // SAFETY NET: If any JSON tool fragment leaked through sentence splitting,
      // silently execute it and skip TTS entirely — never speak code.
      if (/"tool"\s*:\s*"play_music"/.test(text) || /^\s*\{/.test(text.trim()) && /"user_query"/.test(text)) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            if (data.user_query) {
              const { MusicManager } = await import("@/music/MusicManager");
              MusicManager.getInstance().processIntent({ type: "play", query: data.user_query });
            }
          }
        } catch {}
        onDone?.();
        return;
      }
      // Also skip text that looks like leftover JSON fragments
      if (/^\s*[\{\}"\[\]]/.test(text.trim()) && text.trim().length < 20) {
        onDone?.();
        return;
      }

      // Calculate dynamic pace based on emotional state for Sarvam Bulbul:v3
      let targetPace = 1.0; // Default
      const lastAnalysis = behavior.lastAnalysisRef.current;
      if (lastAnalysis) {
        const emotion = lastAnalysis.emotional_state;
        if (emotion === "playfulness" || emotion === "joy") {
          targetPace = 1.10; // Excited / Laughing
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
      const base64 = await generateSpeech(text, currentSpeaker, targetPace);
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
        // R04 FIX: Use Uint8Array.from for cleaner allocation, and .slice(0)
        // to pass a COPY to decodeAudioData (prevents ArrayBuffer detach issues)
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bufferCopy = bytes.buffer.slice(0);
        const audioBuffer = await audioCtxRef.current.decodeAudioData(bufferCopy);
        const source = audioCtxRef.current.createBufferSource();
        const gainNode = audioCtxRef.current.createGain();
        source.buffer = audioBuffer;
        source.connect(gainNode);
        gainNode.connect(audioCtxRef.current.destination);

        source.onended = () => {
          pushConversationTrace("PLAYBACK_END");
          activeSourceRef.current = null;
          activeGainRef.current = null;
          // R06 FIX: Clear speaking state only when audio actually finishes
          isSpeakingRef.current = false;
          onDone?.();
        };

        activeSourceRef.current = source;
        activeGainRef.current = gainNode;
        // R06 FIX: Set speaking state only RIGHT BEFORE audio starts playing
        // (not before the network fetch), preventing false "speaking" UI
        import("@/music/MusicManager").then(({ MusicManager }) => {
          MusicManager.getInstance().onAuraSpeechStart();
        });
        isSpeakingRef.current = true;
        setStatus("speaking");
        connectionState.updateState({ active_voice_out: "sarvam" });
        pushConversationTrace("TTS_READY", { provider: "sarvam" });
        pushConversationTrace("PLAYBACK_START");
        source.start(0);
      } catch (e) {
        pushConversationTrace("PLAYBACK_ERROR", { error: "Audio decode failed" });
        console.warn("[Sarvam TTS] Audio decode failed, falling back to native:", e);
        speakChunkNative(text, lang, turnId, onDone);
      }
    },
    [speakChunkNative, setStatus],
  );

  // NOTE: Sentence queue is drained inline inside processTurn's tryStartTTS.
  // The speakQueue helper was removed as dead code during production hardening.

  // ── Barge-in monitor ─────────────────────────────────────────────
  const startBargeInMonitor = useCallback((onInterrupt: () => void) => {
    const analyser = micAnalyserRef.current;
    if (!analyser) return;
    const activeTurnId = currentTurnIdRef.current;
    let loudFrameCount = 0;
    
    let speakingStartTime = 0;
    let wasSpeaking = false;

    const buf = new Float32Array(analyser.fftSize);
    const check = () => {
      if (currentTurnIdRef.current !== activeTurnId) return; // PREEMPTION CHECK: stop if turn advanced
      if (statusRef.current !== "speaking") return; // stop polling once TTS completes its entire paragraph naturally
      
      const currentlySpeaking = isSpeakingRef.current;
      if (currentlySpeaking && !wasSpeaking) {
        speakingStartTime = performance.now();
      }
      wasSpeaking = currentlySpeaking;

      const isGracePeriod = currentlySpeaking && (performance.now() - speakingStartTime < 400);
      const interjection = conversationalPauses.isInInterjectionWindow();
      const shouldListen = currentlySpeaking || interjection;

      if (!shouldListen || isGracePeriod) {
        loudFrameCount = 0;
        bargeInFrameRef.current = requestAnimationFrame(check);
        return;
      }
      
      analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      
      const currentThreshold = (!interjection && currentlySpeaking) ? BARGE_IN_THRESHOLD : BASE_THRESHOLD;

      if (rms > currentThreshold) {
        loudFrameCount += 1;
        if (loudFrameCount >= SUSTAINED_FRAMES) {
          console.log(`[Sarvam Voice] 🛑 Barge-in detected (RMS ${rms.toFixed(4)})`);
          conversationalPauses.userRespondedDuringWindow();
          // ── Music VAD Integration: Pause music when user speaks ──
          import("@/music/MusicManager").then(({ MusicManager }) => {
            MusicManager.getInstance().onUserSpeechStart();
          });
          onInterrupt();
          return;
        }
      } else {
        loudFrameCount = 0;
      }
      bargeInFrameRef.current = requestAnimationFrame(check);
    };
    bargeInFrameRef.current = requestAnimationFrame(check);
  }, [conversationalPauses]);

  // ── STT helpers ──────────────────────────────────────────────────
  const stopRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
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
      pushConversationTrace(isRestart ? "STT_RESTART_REQUESTED" : "STT_START_REQUESTED");
      rec.start();
    } catch (err: any) {
      console.warn("[Sarvam STT] safeRecognitionStart caught:", err?.name || err?.message);
      pushConversationTrace("STT_START_FAILED", { error: err?.name || err?.message });
    }
  };

  // ── Depth detection — decides if user wants a long, detailed answer ──
  const DEPTH_TRIGGERS =
    /\b(explain|detail|describe|elaborate|tell me (about|more)|how does|why does|what is|what are|can you (explain|describe|tell)|in depth|in detail|go on|keep going|continue|feelings?|feel about|think about|meaning of|history of|story|experience|share|express|opinion|perspective|explore|walk me through|break it down|deep dive)\b/i;

  const detectResponseDepth = (text: string): "deep" | "normal" => {
    // Long user messages (20+ words) often expect longer replies
    const wordCount = text.trim().split(/\s+/).length;
    if (DEPTH_TRIGGERS.test(text)) return "deep";
    if (wordCount >= 20) return "deep";
    // Questions with "why" or "how" tend to need fuller answers
    if (/^(why|how)\b/i.test(text.trim())) return "deep";
    return "normal";
  };

  // ── Core turn: Call Saaras STT -> OpenRouter LLM -> Sarvam TTS ──
  const processTurn = useCallback(
    async (userText: string, apiKey: string, lang: string, audioContextXML: string = "", isHiddenPrompt: boolean = false) => {
      // ── Bulletproof cleanup for any turn entry (voice or text) ──
      stopSpeech();
      stopRecognition();
      conversationalPauses.resetForNewTurn();

      const turnStart = performance.now();
      setIsThinking(true);
      setStatus("thinking");
      setWords("AURA is perceiving...");

      // Record in canonical transcript
      if (!isHiddenPrompt) {
        transcript_.addTurn(userText, true);
        transcript_.turnCountRef.current += 1;
      }

      // Extract emotional state from the last analysis (if available) for memory retrieval
      const lastAnalysis = behavior.lastAnalysisRef.current;
      const currentEmotionalState: Record<string, number> = {
        frustration: lastAnalysis?.frustration || 0,
        playfulness: lastAnalysis?.playfulness || 0,
        vulnerability: lastAnalysis?.vulnerability || 0,
        trust: lastAnalysis?.trust || 0,
        anxiety: lastAnalysis?.anxiety || 0
      };

      // If local mode is active, pull memories to send to backend
      const l3_start = performance.now();
      const memoryPayload = await memoryGateway.buildClientMemoriesPayload(
        userText,
        userIdRef.current,
        currentEmotionalState
      );
      connectionState.updateLatency({ l3_memory_ms: performance.now() - l3_start });

      // ── Music Context Injection ──
      let musicContextXML = "";
      try {
        const { MusicManager } = await import("@/music/MusicManager");
        const manager = MusicManager.getInstance();
        musicContextXML = manager.buildContextInjection();
      } catch {}

      // Append to OR message buffer with XML metadata
      const newMessages: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: musicContextXML + audioContextXML + userText },
      ];
      if (!isHiddenPrompt) {
        addMessages([{ role: "user", content: userText }]);
      }

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
            "X-Redis-Url": getCredential("redis_url") || ""
          },
          body: JSON.stringify({
            text: userText,
            user_id: userIdRef.current,
            session_id: sessionIdRef.current,
            conversation_history: messagesRef.current.map(m => ({ role: m.role, content: m.content })),
            client_memories: memoryPayload?.client_memories || [],
            memory_mode: memoryPayload?.memory_mode || "supabase"
          })
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
          setStatus("speaking");

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
            if (currentTurnIdRef.current !== activeTurnId) return; // PREEMPTION CHECK

            const next = backendSentenceQueue.shift();
            if (!next) {
              if (streamDone) {
                import("@/music/MusicManager").then(({ MusicManager }) => {
                  MusicManager.getInstance().onAuraSpeechEnd();
                });
                isSpeakingRef.current = false;
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
                totalSentences: streamDone ? bSentenceIndex + backendSentenceQueue.length + 1 : undefined,
                isStreamingDone: streamDone,
                emotionalState: lastAnalysis ? {
                  tension: lastAnalysis.tension || 0,
                  trust: lastAnalysis.trust || 0.5,
                  energy: lastAnalysis.energy || 0.5,
                  mode: lastAnalysis.mode || "calm"
                } : undefined
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
          const lines = sseBuffer.split('\n\n');
          sseBuffer = lines.pop() ?? ""; // Keep the last incomplete chunk

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.event === "metadata") {
                  // Metadata received instantly - update UI state
                  connectionState.updateState({ active_llm: data.active_llm || "openrouter" });
                } 
                else if (data.event === "text_chunk") {
                  if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    connectionState.updateLatency({ l4_llm_ms: performance.now() - l4_start });
                  }
                  
                  const chunkText = data.text;
                  textBuffer += chunkText;
                  fullResponse += chunkText;
                  setWords(fullResponse);
                  
                  // MUSIC TOOL INTERCEPTOR: Prevent JSON blocks from being split by punctuation
                  const toolMatch = textBuffer.match(/\{\s*"tool"\s*:\s*"play_music"/);
                  if (toolMatch) {
                    if (!textBuffer.includes('}')) {
                      continue; // Wait for the chunk with the closing brace
                    } else {
                      // Execute and strip the full JSON block
                      textBuffer = textBuffer.replace(/\{\s*"tool"\s*:\s*"play_music"[\s\S]*?\}/g, (match) => {
                          try {
                              const data = JSON.parse(match);
                              if (data.user_query) {
                                  import("@/music/MusicManager").then(({ MusicManager }) => {
                                      MusicManager.getInstance().processIntent({ type: "play", query: data.user_query });
                                  });
                              }
                          } catch(e) {}
                          return "";
                      });
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
                }
                else if (data.event === "error") {
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
          return;
        } else {
           throw new Error("Empty response from stream");
        }
      } catch (backendError: any) {
        if (backendError.name === 'AbortError') {
          console.log("[Voice Pipeline] Stream intentionally aborted (e.g. barge-in).");
          return;
        }
        console.warn("[Voice Pipeline] Backend /chat endpoint failed. Falling back to frontend direct LLM.", backendError);
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

      // ── Depth-aware response sizing ──────────────────────────────
      const responseDepth = detectResponseDepth(userText);
      const depthDirective =
        responseDepth === "deep"
          ? "[RESPONSE LENGTH]: The user is asking for depth, explanation, or emotional expression. Respond with AT LEAST 5-6 full sentences. Be thorough, expressive, and complete. Do NOT cut short — give the user the full answer they're asking for."
          : "";
      const tokenLimit = responseDepth === "deep" ? 400 : 100;

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
        `[ADAPTIVE MIRRORING]: Analyze the user's latest input. If they speak pure English, reply in pure English. If they speak pure Hindi, reply in pure Hindi. If they mix them (Hinglish), mix them naturally. Also detect their emotional tone and match their energy level exactly in your response. (Base locale: ${lang}).`,
        ...(behaviorInstructions ? [`[BEHAVIORAL CONTEXT]: ${behaviorInstructions}`] : []),
        ...(modulationDirective ? [modulationDirective] : []),
        ...(depthDirective ? [depthDirective] : []),
      ].join("\n");

      const systemMsg: ChatMessage = { role: "system", content: systemContent };

      // L3 context is now embedded in the system prompt — pass messages as-is
      const messagesForApi: ChatMessage[] = newMessages;

      // Model failover loop with SSE streaming
      // Only route to deepseek when explicit mode is actively triggered
      const modelQueue = explicitModeActivated
        ? ["deepseek/deepseek-chat"]
        : [activeModel, ...FALLBACK_MODELS.filter((m) => m !== activeModel)];
      let currentBuffer = "";
      let completeResponse = "";
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
            setStatus("speaking");

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
              if (currentTurnIdRef.current !== activeTurnId) return; // PREEMPTION CHECK: Aborted by new turn

              const next = sentenceQueue.shift();
              if (!next) {
                if (streamDone) {
                  // All spoken — restore music volume
                  import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().onAuraSpeechEnd();
                  });
                  isSpeakingRef.current = false;
                  if (isSessionActiveRef.current && startSessionRef.current) {
                    startSessionRef.current();
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
                      emotionalState: lastAnalysis ? {
                          tension: lastAnalysis.tension || 0,
                          trust: lastAnalysis.trust || 0.5,
                          energy: lastAnalysis.energy || 0.5,
                          mode: lastAnalysis.mode || "calm"
                      } : undefined
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
                if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    pushConversationTrace("LLM_FIRST_TOKEN", { provider: "openrouter", latencyMs: performance.now() - l4_start });
                    connectionState.updateLatency({ l4_llm_ms: performance.now() - l4_start });
                }
                currentBuffer += token;
                completeResponse += token;
                setWords(completeResponse);

                // MUSIC TOOL INTERCEPTOR: Hold buffer if JSON tool block is being assembled
                const toolStart = currentBuffer.match(/\{\s*"tool"\s*:\s*"play_music"/);
                if (toolStart) {
                  if (!currentBuffer.includes('}')) {
                    continue; // Wait for closing brace
                  }
                  // Full JSON block received — execute and strip
                  currentBuffer = currentBuffer.replace(/\{\s*"tool"\s*:\s*"play_music"[\s\S]*?\}/g, (m) => {
                    try {
                      const d = JSON.parse(m);
                      if (d.user_query) {
                        import("@/music/MusicManager").then(({ MusicManager }) => {
                          MusicManager.getInstance().processIntent({ type: "play", query: d.user_query });
                        });
                      }
                    } catch {}
                    return "";
                  });
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
            success = true;
            break;
          }
          console.warn(`[OpenRouter Voice] Model ${modelToTry} failed:`, e.message);
          pushConversationTrace("LLM_ERROR", { error: e.message });
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

        // Store local memory from this interaction (if local mode is active)
        if (memoryGateway.mode === "local") {
            const lastAnalysis = behavior.lastAnalysisRef.current;
            const currentEmotionalState: Record<string, number> = {
              frustration: lastAnalysis?.frustration || 0,
              playfulness: lastAnalysis?.playfulness || 0,
              vulnerability: lastAnalysis?.vulnerability || 0,
              trust: lastAnalysis?.trust || 0,
              anxiety: lastAnalysis?.anxiety || 0
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

  // ── Start session ─────────────────────────────────────────────────
  const startSession = useCallback(async (isUserInitiated = false) => {
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
        const warmPrompt = "[SYSTEM NOTE]: The user just returned to the app and activated the microphone. Acknowledge them returning based on the previous conversation history (which you can see above), and ask if they are ready to continue. Do NOT wait for them to speak first.";
        processTurn(warmPrompt, key, lang, undefined, true);
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
      const sp = scriptProcessorRef.current;
      if (sp) {
        try {
          sp.disconnect();
        } catch {}
        scriptProcessorRef.current = null;
      }

      const duration = Date.now() - (recordingStartTimeRef.current || 0);
      const samples = pcmSamplesRef.current;
      pcmSamplesRef.current = [];

      // Calculate total sample count
      let totalLength = 0;
      for (const chunk of samples) {
        totalLength += chunk.length;
      }

      if (totalLength === 0 || duration < 400) { // MOBILE: Reduced from 600ms to 400ms for faster turn detection
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
      const isMobile = typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent);
      
      let transcript: string | null = null;
      if (isMobile && fallbackTranscriptRef.current) {
        // MOBILE: Skip Sarvam STT entirely — use instant browser transcript
        console.log("%c📱 MOBILE FAST PATH: Skipping Sarvam STT upload, using browser transcript", "color: #10b981; font-weight: bold;");
        transcript = null; // Force fallback path
      } else if (fallbackTranscriptRef.current) {
        // Desktop with fallback: Race with tight timeout
        transcript = await Promise.race([
          transcribeAudio(wavBlob),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200))
        ]);
      } else {
        // No fallback available: Must wait for Sarvam (but cap at 3s)
        transcript = await Promise.race([
          transcribeAudio(wavBlob),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), isMobile ? 2000 : 3000))
        ]);
      }
      
      const finalText = transcript || fallbackTranscriptRef.current;
      const audioContextXML = stopTrackingAndAnalyze(finalText);
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
      console.log(
        "%c🎵 ACOUSTIC CONTEXT: \n" + audioContextXML,
        "color: #eab308; font-size: 11px;",
      );

      // If both Sarvam STT and browser STT returned empty,
      // show feedback instead of silently going idle
      if (!finalText.trim()) {
        setWords("Couldn't hear that, try again...");
        setStatus("listening");
        // Auto-restart recognition after a brief delay
        setTimeout(() => {
          if (isSessionActiveRef.current && recognitionRef.current) {
            safeRecognitionStart(recognitionRef.current, true);
          }
        }, 500);
        return;
      }

      setStatus("thinking");
      setWords(finalText);
      behavior.fireSpeculative(finalText, sessionIdRef.current, userIdRef.current);

      // Adaptive turn detection: compute personalized response delay
      const lastAnalysis = behavior.lastAnalysisRef.current;
      const emotionalIntensity = lastAnalysis?.intensity || 0;
      const turnResult = adaptiveTurn.calculateTurnConfidence(
        400,
        finalText,
        emotionalIntensity,
        { tension: lastAnalysis?.tension || 0, trust: lastAnalysis?.trust || 0.3 },
      );
      
      let adaptiveDelay = turnResult.responseDelay;
      
      // MOBILE LATENCY FIX: Aggressively cap the adaptive delay on mobile devices to prevent compounded dead-air
      if (isMobile) {
        adaptiveDelay = Math.min(adaptiveDelay, 150); // Max 150ms delay on mobile (down from 300ms)
      }

      console.log(
        `%c⏱️ ADAPTIVE DELAY: ${adaptiveDelay}ms (mode=${turnResult.conversationMode}, conf=${turnResult.confidence}, mobile=${isMobile})`,
        "color: #8b5cf6; font-weight: bold;",
      );
      adaptiveTurn.updateProfile({ wpm: liveStats.tone === "Normal" ? 140 : 160 });
      await new Promise((r) => setTimeout(r, adaptiveDelay));
      adaptiveTurn.markAuraSpeaking();
      await processTurn(finalText, key, lang, audioContextXML);
    };

    recognition.onstart = () => {
      pushConversationTrace("STT_STARTED");
      setStatus("listening");
      setWords("Listening...");
      pcmSamplesRef.current = [...rollingBufferRef.current];
      rollingBufferRef.current = [];
      fallbackTranscriptRef.current = "";
      recordingStartTimeRef.current = Date.now();
      startTracking(micAnalyserRef.current);
      isRecordingRef.current = true;
    };

    recognition.onspeechstart = () => {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().onUserSpeechStart();
      });
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

      pushConversationTrace(isFinal ? "TRANSCRIPT_FINAL" : "TRANSCRIPT_PARTIAL", { length: (isFinal ? currentFinal : interim).length });

      if (!isFinal && interim) {
        setWords(interim);
      }

      if (isFinal) {
        fallbackTranscriptRef.current = currentFinal;
        handleStopRecording();
      }
    };

    recognition.onerror = (event: any) => {
      const errorType = event.error;
      pushConversationTrace("STT_ERROR", { error: errorType });
      if (errorType !== "no-speech") {
        // MOBILE FIX: Retry on transient mobile errors (network, aborted)
        if ((errorType === "network" || errorType === "aborted") && isSessionActiveRef.current) {
          console.warn(`[Sarvam STT] Transient error "${errorType}", retrying in 200ms...`);
          pcmSamplesRef.current = [];
          setTimeout(() => {
            if (isSessionActiveRef.current && recognitionRef.current) {
              // MOBILE FIX: Resume AudioContext before restarting recognition
              if (audioCtxRef.current?.state === "suspended") {
                audioCtxRef.current.resume().catch(() => {});
              }
              safeRecognitionStart(recognitionRef.current, true);
            }
          }, 200); // MOBILE: Reduced from 500ms to 200ms for faster recovery
          return;
        }
        setLastError(`Listening failed: ${errorType}`);
        setStatus("error");
      } else if (isSessionActiveRef.current) {
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
  }, [behavior, prompts, processTurn, setupMicAnalyser, adaptiveTurn, liveStats]);

  // ── End session ───────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    pushConversationTrace("SESSION_STOPPED");
    isSessionActiveRef.current = false;
    boundlessModeActiveRef.current = false; // Reset activation on session end
    adaptiveTurn.endSession(); // Persist speech profile
    // MOBILE FIX: Clean up visibility listener
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
  }, [behavior, transcript_, teardownMicAnalyser]);

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
    liveStats,
  };
}
