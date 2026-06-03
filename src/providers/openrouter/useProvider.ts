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
import { ContextBudgetManager } from "@/lib/context-budget";
import { getStorageManager } from "@/lib/storage/manager";
import { generateSeed } from "@/lib/utils/seed-generator";
import { hasSupabaseCredentials } from "@/lib/credentials";
import { saveSyncMeta } from "@/lib/sync-meta";
import { getCredential } from "@/lib/credentials";
import { useBehaviorInjection } from "../gemini/useBehaviorInjection";
import { usePromptOrchestrator } from "../gemini/usePromptOrchestrator";
import { useTranscriptManager } from "../gemini/useTranscript";
import { getSystemPromptForPersonality } from "@/lib/gemini-prompt";
import { getAdaptiveModulation } from "@/lib/adaptive-modulation";
import type { UserPresentation } from "@/lib/adaptive-modulation";
import type { ChatMessage } from "./types";
import {
  JoyfulPassionSystemPrompt,
  isJoyfulPassionMode,
  detectActivationPhrase,
  detectDeactivationPhrase,
} from "../../modes/JoyfulPassionMode";
import { useVoiceAcoustics } from "../../hooks/useVoiceAcoustics";
import { connectionState } from "@/config/connectionState";
import { ENDPOINTS } from "@/config/api";
import { memoryGateway } from "@/lib/memory-gateway";
import { useBargeIn } from "./useInterruption.ts";
import { useAdaptiveTurnDetection } from "@/shared/useAdaptiveTurnDetection";
import { useConversationalPauses } from "@/shared/useConversationalPauses";

export type { ChatMessage };

export type SegmentStyle = "normal" | "aside" | "thinking" | "whisper" | "laugh" | "sigh" | "breath" | "cry" | "grunt" | "scoff" | "moan" | "serious" | "excited";

export interface SpeechSegment {
  text: string;
  style: SegmentStyle;
}

const ACTION_COOLDOWN = 10000;
let lastActionTime = 0;

// ─── Audio Asset Styles (physical sounds that play MP3s) ────────────
const AUDIO_ASSET_STYLES: ReadonlySet<SegmentStyle> = new Set([
  "laugh", "sigh", "breath", "cry", "grunt", "scoff", "moan"
]);

export function parseSegments(text: string): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  
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

  const noEmojis = processedText.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
  const regex = /\*([^*]+)\*|\(([^)]+)\)|\[([^\]]+)\]|<([^>]+)>/g;
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(noEmojis)) !== null) {
    if (match.index > lastIndex) {
      const normalText = noEmojis.substring(lastIndex, match.index).trim();
      if (normalText) {
        segments.push({ text: normalText, style: "normal" });
      }
    }
    
    const actionText = (match[1] || match[2] || match[3] || match[4] || "").trim();
    const actionLower = actionText.toLowerCase();
    const now = performance.now();
    const canAct = (now - lastActionTime) > ACTION_COOLDOWN;
    
    // ── Music Intent Tags → MusicManager ──
    if (actionText.startsWith("PLAY_YOUTUBE:")) {
      const query = actionText.replace("PLAY_YOUTUBE:", "").trim();
      // Route through MusicManager instead of raw CustomEvents
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "play", query });
      });
      lastIndex = regex.lastIndex;
      continue;
    }
    
    if (actionText === "STOP_YOUTUBE") {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "stop" });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText === "PAUSE_MUSIC") {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "pause" });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText === "RESUME_MUSIC") {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "resume" });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText === "NEXT_SONG") {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "next" });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText === "PREV_SONG") {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "previous" });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText === "VOLUME_UP") {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "volume_up" });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText === "VOLUME_DOWN") {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "volume_down" });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText.startsWith("VOLUME:")) {
      const level = parseFloat(actionText.replace("VOLUME:", "").trim());
      if (!isNaN(level)) {
        import("@/music/MusicManager").then(({ MusicManager }) => {
          MusicManager.getInstance().processIntent({ type: "volume", level });
        });
      }
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText.startsWith("MUSIC_ASSOCIATION:")) {
      const text = actionText.replace("MUSIC_ASSOCIATION:", "").trim();
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "association", text });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    if (actionText.startsWith("MUSIC_EMOTION:")) {
      const text = actionText.replace("MUSIC_EMOTION:", "").trim();
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().processIntent({ type: "emotion", text });
      });
      lastIndex = regex.lastIndex;
      continue;
    }

    let style: SegmentStyle = "aside";
    if (actionLower.includes("laugh") || actionLower.includes("chuckle") || actionLower.includes("giggle")) style = "laugh";
    else if (actionLower.includes("sigh")) style = "sigh";
    else if (actionLower.includes("breath") || actionLower.includes("inhale") || actionLower.includes("exhale")) style = "breath";
    else if (actionLower.includes("cry") || actionLower.includes("sob") || actionLower.includes("tear") || actionLower.includes("sniffle")) style = "cry";
    else if (actionLower.includes("grunt") || actionLower.includes("groan") || actionLower.includes("ugh")) style = "grunt";
    else if (actionLower.includes("scoff") || actionLower.includes("rolls eyes") || actionLower.includes("dismissive")) style = "scoff";
    else if (actionLower.includes("moan") || actionLower.includes("pant") || actionLower.includes("breathe heavily")) style = "moan";
    else if (match[2] || actionLower.includes("thinking") || actionLower.includes("ponders") || actionLower.includes("considers")) style = "thinking";
    else if (match[3] || actionLower.includes("whisper") || actionLower.includes("murmur") || actionLower.includes("softly")) style = "whisper";
    else if (actionLower.includes("serious") || actionLower.includes("stern") || actionLower.includes("firm")) style = "serious";
    else if (actionLower.includes("excited") || actionLower.includes("beaming") || actionLower.includes("grinning")) style = "excited";
    
    if (AUDIO_ASSET_STYLES.has(style)) {
      if (canAct) {
        segments.push({ text: "", style });
        lastActionTime = now;
      }
    }
    // Intentionally dropping non-audio actionText so AURA doesn't speak her stage directions.
    
    lastIndex = regex.lastIndex;
  }
  
  const trailingText = noEmojis.substring(lastIndex).trim();
  if (trailingText) {
    segments.push({ text: trailingText, style: "normal" });
  }
  
  return segments;
}

// ─── Smart Audio Loader with Gender Fallback Chain ──────────────────
// Priority: gender-specific file → shared gender-neutral file → null (skip)
const getAudioClip = (filename: string) => {
    if (typeof window === 'undefined') return null;
    return new Audio(`/emotion_sounds/${filename}`);
};

/**
 * Audio Asset Table — maps each emotion key to:
 *   [0] female-specific filename
 *   [1] male-specific filename
 *   [2] shared gender-neutral fallback (works for both)
 */
const ASSET_TABLE: Record<string, [string, string, string | null]> = {
  laughs:  ['female_laugh.mp3',       'male_laugh.mp3',       'soft_laugh.mp3'],
  sighs:   ['female-sigh.mp3',        'male_sigh.mp3',        'deep_sigh.mp3'],
  breaths: ['female_deepbreath.mp3',  'male_deepbreath.mp3',  'inhale.mp3'],
  cries:   ['female_cry.mp3',         'male_cry.mp3',         null],
  grunts:  ['female_grunt.mp3',       'male_grunt.mp3',       null],
  scoffs:  ['female_scoff.mp3',       'male_scoff.mp3',       'scoff.mp3'],
  moans:   ['female_m_sound.mp3',     'male_moan.mp3',        null],
};

const audioClips: Record<string, HTMLAudioElement | null> = {
    laughs: null, sighs: null, breaths: null, cries: null,
    grunts: null, scoffs: null, moans: null,
};

let activeGender = "";

const initAudioClips = () => {
    if (typeof window === 'undefined') return;
    
    const gender = localStorage.getItem("aura_voice_gender") || "female";
    
    // Only re-initialize if not loaded or if gender changed mid-session
    if (!audioClips.laughs || activeGender !== gender) {
        activeGender = gender;
        const idx = gender === "female" ? 0 : 1;
        
        for (const [key, files] of Object.entries(ASSET_TABLE)) {
            // Try gender-specific file first; use shared fallback if available
            audioClips[key] = getAudioClip(files[idx]);
            
            // Preload the audio so the browser caches it and can report duration
            if (audioClips[key]) {
                audioClips[key]!.preload = "auto";
                // If the gender-specific file 404s at play time, the onerror handler
                // in playAudioAsset will gracefully skip. But if a shared fallback exists,
                // we also keep it ready to swap in at play time.
            }
        }
    }
};

/**
 * Thinking Intent Audio Table — maps each intent to:
 *   [0] female-specific filename
 *   [1] male-specific filename  
 *   [2] shared gender-neutral fallback
 */
const THINKING_AUDIO_TABLE: Record<string, [string, string, string | null]> = {
  analytical: ['female_hmm.mp3',           'male_hmm.mp3',           null],
  searching:  ['female_inhale.mp3',        'male_inhale.mp3',        'inhale.mp3'],
  uncertain:  ['female_soft_uh.mp3',       'male_soft_uh.mp3',       null],
  emotional:  ['female_soft_sigh.mp3',     'male_soft_sigh.mp3',     'deep_sigh.mp3'],
  amused:     ['female_soft_laugh.mp3',    'male_soft_laugh.mp3',    'soft_laugh.mp3'],
  excited:    ['female_excited_inhale.mp3','male_excited_inhale.mp3','inhale.mp3'],
};

/** Resolve a thinking intent to the best available audio file for the current gender */
function resolveThinkingCue(intent: string): string | null {
  const entry = THINKING_AUDIO_TABLE[intent];
  if (!entry) return null;
  const gender = localStorage.getItem("aura_voice_gender") || "female";
  const primary = entry[gender === "female" ? 0 : 1];
  const fallback = entry[2];
  // Return primary; playback will attempt it first, and if it 404s the
  // onerror cleanup fires instantly (0ms skip). But if a shared fallback
  // exists, we prefer it for male voices that lack specific files.
  if (gender !== "female" && fallback) {
    // For male: use shared asset unless male-specific exists in emotion_sounds/
    return primary; // attempt gender-specific; engine degrades gracefully
  }
  return primary;
}

// ─── Audio Style → Clip Key mapping ─────────────────────────────────
const STYLE_TO_CLIP: Record<string, string> = {
  laugh: "laughs", sigh: "sighs", breath: "breaths",
  cry: "cries", grunt: "grunts", scoff: "scoffs", moan: "moans",
};

export function playAudioAsset(
  style: "laugh" | "sigh" | "breath" | "cry" | "grunt" | "scoff" | "moan",
  onDone: () => void
) {
  initAudioClips();
  const clipKey = STYLE_TO_CLIP[style];
  let clip = clipKey ? audioClips[clipKey] : null;
  
  const cleanup = () => {
    if (clip) {
      clip.onended = null;
      clip.onerror = null;
    }
    onDone();
  };

  const ttsFallback = () => {
    // Generate verbal equivalent for missing audio files
    let verbal = "";
    switch (style) {
      case "laugh": verbal = "Haha"; break;
      case "sigh": verbal = "Haaah"; break;
      case "breath": verbal = "Huuuh"; break;
      case "cry": verbal = "Sob"; break;
      case "grunt": verbal = "Ugh"; break;
      case "scoff": verbal = "Pfft"; break;
      case "moan": verbal = "Ahhh"; break;
    }
    
    if (!verbal || typeof window === 'undefined' || !window.speechSynthesis) {
      cleanup();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(verbal);
    utterance.volume = 0.6; // Softer so it sounds like a filler/breath
    utterance.rate = 1.1;
    utterance.pitch = style === "scoff" ? 1.2 : 0.95;
    
    const lang = localStorage.getItem("aura_lang") || "en-US";
    utterance.lang = lang;
    
    const voices = window.speechSynthesis.getVoices();
    const matching = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang.toLowerCase().split("-")[0]));
    const premium = matching.find((v) => v.name.toLowerCase().includes("google") || v.name.toLowerCase().includes("natural") || v.name.toLowerCase().includes("premium"));
    if (premium ?? matching[0]) utterance.voice = premium ?? matching[0];
    
    utterance.onend = cleanup;
    utterance.onerror = cleanup;
    window.speechSynthesis.speak(utterance);
  };
  
  // If the gender-specific file 404s, try the shared fallback before giving up
  const tryFallback = () => {
    const entry = ASSET_TABLE[clipKey];
    if (entry && entry[2]) {
      const fallbackClip = getAudioClip(entry[2]);
      if (fallbackClip) {
        fallbackClip.onended = cleanup;
        fallbackClip.onerror = ttsFallback;
        fallbackClip.play().catch(ttsFallback);
        return;
      }
    }
    ttsFallback();
  };

  if (!clip) {
    tryFallback();
    return;
  }
  
  // Intelligent Clip Trimming for Moans (Plays random 0.8s - 1.5s segment)
  if (style === "moan") {
    const clipDuration = isNaN(clip.duration) ? 3.0 : clip.duration;
    const snippetLength = 0.8 + Math.random() * 0.7; 
    const maxStart = Math.max(0, clipDuration - snippetLength);
    clip.currentTime = Math.random() * maxStart;
    
    clip.onended = null;
    clip.onerror = tryFallback;
    
    clip.play().then(() => {
      setTimeout(() => {
        clip!.pause();
        cleanup();
      }, snippetLength * 1000);
    }).catch(tryFallback);
    return;
  }
  
  clip.onended = cleanup;
  clip.onerror = tryFallback;
  clip.play().catch(tryFallback);
}
// ───────────────────────────────────────────────────────────────────

export type ThinkingIntent = "analytical" | "searching" | "uncertain" | "emotional" | "amused" | "excited";

export function inferThinkingIntent(text: string): ThinkingIntent {
  const lower = text.toLowerCase();
  if (/\b(how|why|what is|code|math|error|bug|architecture|system|solve|fix|technical|explain|compare)\b/i.test(lower)) return "analytical";
  if (/\b(sad|hurt|cry|frustrating|disappointing|sorry|feel|pain|empathy|miss|lonely|scared)\b/i.test(lower)) return "emotional";
  if (/\b(haha|joke|funny|lol|lmao|hilarious|sarcasm|playful|rofl)\b/i.test(lower)) return "amused";
  if (/\b(wow|amazing|awesome|finally|did it|yes|omg|breakthrough|celebrate|incredible|nailed)\b/i.test(lower)) return "excited";
  if (/\b(remember|recall|think about|ideas|brainstorm|explore|search|imagine|wonder)\b/i.test(lower)) return "searching";
  if (/\b(maybe|what if|depends|ambiguous|unclear|possibly|not sure|confused)\b/i.test(lower) || text.trim().endsWith("?")) return "uncertain";
  return "searching"; // default
}

const fillerPhrases = {
  analytical: ["Hmm...", "Let's see...", "Interesting..."],
  searching: ["Let's think...", "Okay...", "So..."],
  uncertain: ["Hmm...", "It depends...", "Possibly..."],
  emotional: ["Mm...", "I see...", "Yeah..."],
  amused: ["Heh...", "Haha...", "Oh that's good."],
  excited: ["Oh!", "Nice!", "That's awesome!"]
};

let lastFiller = "";
export function getRandomFiller(intent: ThinkingIntent): string {
  const options = fillerPhrases[intent];
  let choice = options[Math.floor(Math.random() * options.length)];
  if (choice === lastFiller && options.length > 1) {
    choice = options.find(o => o !== lastFiller) || choice;
  }
  lastFiller = choice;
  return choice;
}

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
const BARGE_IN_THRESHOLD = 0.018;

// ─── Hook ───────────────────────────────────────────────────────────
import { pushConversationTrace } from "../../core/telemetry";

export function useOpenRouter(mode: string = "adaptive") {
  // ── R01 FIX: Inactive guard — skip all resource allocation ──
  const isInactive = mode === "__inactive__";
  const isInactiveRef = useRef(isInactive);
  useEffect(() => {
    isInactiveRef.current = isInactive;
  }, [isInactive]);

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
  const lastAudioEndRef = useRef<number>(0);

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

  const sentenceQueueRef = useRef<string[]>([]);
  const thinkingTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const activeThinkingAudioRef = useRef<HTMLAudioElement | null>(null);
  const spokenTextRef = useRef<string>("");
  const wasInterruptedRef = useRef<boolean>(false);

  // ── Real waveform: microphone AudioAnalyser ──────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

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
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      // MOBILE FIX: Auto-resume suspended AudioContext (iOS/Android policy)
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }

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

      micAnalyserRef.current = analyser;
    } catch {
      console.warn("[OpenRouter Voice] Could not open mic analyser.");
    }
  }, []);

  const teardownMicAnalyser = useCallback(() => {
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

  // Brain sub-hooks (independently initialised — skip when inactive)
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
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
  };
  
  const stopThinkingAudio = useCallback(() => {
    if (activeThinkingAudioRef.current) {
      activeThinkingAudioRef.current.pause();
      activeThinkingAudioRef.current.currentTime = 0;
      activeThinkingAudioRef.current = null;
    }
    thinkingTimeoutsRef.current.forEach(clearTimeout);
    thinkingTimeoutsRef.current = [];
  }, []);

  const speakChunk = useCallback((text: string, lang: string, style: SegmentStyle, onDone?: () => void) => {
    if (isInactiveRef.current) {
      onDone?.();
      return;
    }
    // SAFETY NET: Never speak JSON tool calls — silently execute and skip
    if (/"tool"\s*:\s*"play_music"/.test(text) || /^\s*\{/.test(text.trim()) && /"user_query"/.test(text)) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          if (data.user_query) {
            import("@/music/MusicManager").then(({ MusicManager }) => {
              MusicManager.getInstance().processIntent({ type: "play", query: data.user_query });
            });
          }
        }
      } catch {}
      onDone?.();
      return;
    }
    // Skip leftover JSON fragments
    if (/^\s*[\{\}"\[\]]/.test(text.trim()) && text.trim().length < 20) {
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

    if (style === "aside") {
      utterance.pitch = 0.9;
      utterance.rate = 0.95;
      utterance.volume = 0.85;
    } else if (style === "thinking") {
      utterance.pitch = 0.95;
      utterance.rate = 0.9;
      utterance.volume = 0.9;
    } else if (style === "whisper") {
      utterance.pitch = 0.9;
      utterance.rate = 0.92;
      utterance.volume = 0.4;
    } else if (style === "serious") {
      utterance.pitch = 0.8;
      utterance.rate = 0.95;
      utterance.volume = 1.0;
    } else if (style === "excited") {
      utterance.pitch = 1.1;
      utterance.rate = 1.05;
      utterance.volume = 1.0;
    } else if (style === "scoff") {
      utterance.pitch = 1.05;
      utterance.rate = 1.1;
      utterance.volume = 0.9;
    } else {
      // Micro-jitter for "normal" style — prevents robotic monotone
      // Each sentence gets a slightly different pitch/rate so the ear
      // never detects a repetitive AI pattern.
      const jitterPitch = 0.97 + Math.random() * 0.06;  // 0.97 – 1.03
      const jitterRate  = 0.97 + Math.random() * 0.06;  // 0.97 – 1.03
      utterance.pitch = jitterPitch;
      utterance.rate = jitterRate;
      utterance.volume = 1.0;
    }

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
      const startMs = performance.now();
      const endMs = lastAudioEndRef.current;
      if (endMs > 0) {
        const gap = startMs - endMs;
        if (gap >= 1500) {
          console.error(`🚨 [AURA Timing] FAILURE: Speech gap was ${Math.round(gap)}ms (exceeded 1500ms max)`);
        } else if (gap >= 1200) {
          console.warn(`⚠️ [AURA Timing] WARNING: Speech gap was ${Math.round(gap)}ms (target: <600ms)`);
        } else if (gap > 600) {
          console.log(`[AURA Timing] Acceptable gap: ${Math.round(gap)}ms`);
        }
      }
      pushConversationTrace("PLAYBACK_START");
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().onAuraSpeechStart();
      });
      isSpeakingRef.current = true;
      setStatus("speaking");
      connectionState.updateState({ active_voice_out: "webspeech" });
    };
    utterance.onend = () => {
      lastAudioEndRef.current = performance.now();
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
    pushConversationTrace("TTS_READY", { provider: "webspeech" });
    
    if (typeof window !== "undefined") {
      (window as any)._utterances = (window as any)._utterances || [];
      (window as any)._utterances.push(utterance);
    }
    window.speechSynthesis.speak(utterance);
  }, [setStatus]);

  // NOTE: Sentence queue is drained inline inside processTurn's tryStartTTS.
  // The speakQueue helper was removed as dead code during production hardening.

  // ── Barge-in monitor ─────────────────────────────────────────────
  const handleInterruption = useCallback(() => {
    console.log("🛑 BARGE-IN DETECTED: Killing audio and flushing queues.");
    adaptiveTurn.registerFalseDetection();
    conversationalPauses.userRespondedDuringWindow();
    stopSpeech();
    
    // ── Music VAD Integration: Pause music when user speaks ──
    import("@/music/MusicManager").then(({ MusicManager }) => {
      MusicManager.getInstance().onUserSpeechStart();
    });
    
    if (spokenTextRef.current.trim().length > 0) {
      const interruptedText = spokenTextRef.current.trim() + " - [Interrupted]";
      addMessages([{ role: "assistant", content: interruptedText }]);
      transcript_.addTurn(interruptedText, false);
      wasInterruptedRef.current = true;
    }
    
    fetchAbortRef.current?.abort();
    if (isSessionActiveRef.current && startSessionRef.current) {
      startSessionRef.current();
    } else {
      setStatus("idle");
    }
  }, [setStatus, adaptiveTurn, conversationalPauses, addMessages, transcript_]);

  useBargeIn(micAnalyserRef, isSpeakingRef, handleInterruption, sentenceQueueRef, conversationalPauses.isInInterjectionWindow);

  // ── STT helpers ──────────────────────────────────────────────────
  const stopRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      } catch { }
      recognitionRef.current = null;
    }
  };

  /**
   * MOBILE FIX: Guarded recognition.start() wrapper.
   * Prevents InvalidStateError from killing the voice pipeline on mobile.
   */
  const safeRecognitionStart = (rec: any, isRestart = false) => {
    try {
      pushConversationTrace(isRestart ? "STT_RESTART_REQUESTED" : "STT_START_REQUESTED");
      rec.start();
    } catch (err: any) {
      console.warn("[OpenRouter STT] safeRecognitionStart caught:", err?.name || err?.message);
      pushConversationTrace("STT_START_FAILED", { error: err?.name || err?.message });
    }
  };

  // ── Core turn: SSE streaming + sentence-chunked TTS ──────────────
  const processTurn = useCallback(
    async (userText: string, apiKey: string, lang: string, audioContextXML: string = "", isHiddenPrompt: boolean = false) => {
      stopSpeech();
      stopThinkingAudio();
      conversationalPauses.resetForNewTurn();
      lastAudioEndRef.current = 0;
      
      const wasInterrupted = wasInterruptedRef.current;
      spokenTextRef.current = "";
      wasInterruptedRef.current = false;
      
      const turnStart = performance.now();
      setIsThinking(true);
      setStatus("thinking");
      setWords("AURA is perceiving...");

      // -- THINKING INTENT ENGINE --
      // Instantly start thinking audio before L3/L4 API fetches
      const intent = inferThinkingIntent(userText);
      const cueFile = resolveThinkingCue(intent);
      
      if (typeof window !== 'undefined' && cueFile) {
        const audio = new Audio(`/emotion_sounds/${cueFile}`);
        activeThinkingAudioRef.current = audio;
        audio.play().catch(() => {
          // Gender-specific file missing — try shared fallback
          const entry = THINKING_AUDIO_TABLE[intent];
          if (entry && entry[2]) {
            const fallback = new Audio(`/emotion_sounds/${entry[2]}`);
            activeThinkingAudioRef.current = fallback;
            fallback.play().catch(() => {});
          }
        });
      }
      
      // Dead air rule: 500ms verbal filler (uses local TTS — voice-matched)
      thinkingTimeoutsRef.current.push(setTimeout(() => {
        speakChunk(getRandomFiller(intent), lang, "aside");
      }, 500));
      
      // Dead air rule: 1000ms secondary filler
      thinkingTimeoutsRef.current.push(setTimeout(() => {
        speakChunk("Still thinking...", lang, "aside");
      }, 1000));

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
      // If music is active, inject song context into the conversation
      let musicContextXML = "";
      try {
        const { MusicManager } = await import("@/music/MusicManager");
        const manager = MusicManager.getInstance();
        musicContextXML = manager.buildContextInjection();
      } catch {}

      // Append to OR message buffer with the invisible XML tag prepended
      const newMessages: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: musicContextXML + audioContextXML + userText },
      ];
      if (!isHiddenPrompt) {
        addMessages([{ role: "user", content: userText }]);
      }

      // Try Backend SSE Stream first (Phase 2 Full Request Cycle)
      try {
        const l4_start = performance.now();
        fetchAbortRef.current = new AbortController();
        const response = await fetch(ENDPOINTS.analyzeStream, {
          method: "POST",
          signal: fetchAbortRef.current.signal,
          headers: {
            "Content-Type": "application/json",
            "X-OpenRouter-Key": getCredential("openrouter_api_key") || "",
            "X-Gemini-Key": getCredential("aura_gemini_api_key") || ""
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
          throw new Error(`Backend returned status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let fullResponse = "";
        const TERMINAL_PUNCTUATION = /[.?!।]\s|\n/;
        let firstTokenReceived = false;
        sentenceQueueRef.current = [];
        let ttsStarted = false;
        let streamDone = false;

          let segmentSubQueue: SpeechSegment[] = [];
          let sentenceIndex = 0;
          let lastSpokenSentence = "";

          const tryStartTTS = () => {
            if (ttsStarted || sentenceQueueRef.current.length === 0) return;
            ttsStarted = true;
            setStatus("speaking");

            const drainQueue = () => {
              if (segmentSubQueue.length > 0) {
                const seg = segmentSubQueue.shift()!;
                if (AUDIO_ASSET_STYLES.has(seg.style)) {
                  // Safety Guard: NEVER allow moaning outside of Joyful Passion mode
                  if (seg.style === "moan" && !boundlessModeActiveRef.current) {
                    console.warn("⚠️ Blocked illicit 'moan' audio outside of Joyful Passion mode. Downgrading to sigh.");
                    seg.style = "sigh";
                  }
                  playAudioAsset(seg.style as any, drainQueue);
                } else if (!seg.text) {
                  drainQueue();
                } else {
                  speakChunk(seg.text, lang, seg.style, drainQueue);
                }
                return;
              }

              const rawNext = sentenceQueueRef.current.shift();
              if (!rawNext) {
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
                  setTimeout(drainQueue, 50);
                }
                return;
              }
              
              if (lastSpokenSentence) {
                  const lastAnalysis = behavior.lastAnalysisRef.current;
                  const ctx = {
                      currentSentence: lastSpokenSentence,
                      nextSentence: rawNext,
                      sentenceIndex: sentenceIndex,
                      totalSentences: streamDone ? sentenceIndex + 1 : undefined,
                      isStreamingDone: streamDone,
                      queueSize: sentenceQueueRef.current.length,
                      emotionalState: lastAnalysis ? {
                          tension: lastAnalysis.tension || 0,
                          trust: lastAnalysis.trust || 0.5,
                          energy: lastAnalysis.energy || 0.5,
                          mode: lastAnalysis.mode || "calm"
                      } : undefined
                  };
                  const pause = conversationalPauses.getPause(ctx);
                  
                  const doNext = () => {
                      if (sentenceQueueRef.current.length === 0 && streamDone && !rawNext) return;
                      lastSpokenSentence = rawNext;
                      sentenceIndex++;
                      spokenTextRef.current += (spokenTextRef.current ? " " : "") + rawNext;
                      segmentSubQueue = parseSegments(rawNext);
                      drainQueue();
                  };
                  
                  if (pause.isBreath) {
                      setTimeout(() => {
                          playAudioAsset("breath", doNext);
                      }, pause.durationMs);
                  } else {
                      setTimeout(doNext, pause.durationMs);
                  }
                  return;
              }
              
              lastSpokenSentence = rawNext;
              sentenceIndex++;
              spokenTextRef.current += (spokenTextRef.current ? " " : "") + rawNext;
              segmentSubQueue = parseSegments(rawNext);
              drainQueue();
            };
            drainQueue();
          };

        setIsThinking(false);

        let sseBuffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            if (textBuffer.trim().length > 0) {
              sentenceQueueRef.current.push(textBuffer.trim());
              textBuffer = "";
            }
            streamDone = true;
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
                  // Metadata received instantly - can update UI state here if needed
                } 
                else if (data.event === "text_chunk") {
                  if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    stopThinkingAudio();
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
                    sentenceQueueRef.current.push(sentence.trim());
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
        console.warn("[Voice Pipeline] Backend /analyze/stream endpoint failed. Falling back to frontend direct LLM.", backendError);
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
      } catch { }

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
      } catch { }

      // L3 live context
      const liveContext = prompts.buildContext(modeRef.current);

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
        console.log("[AURA] Mode deactivated — phrase detected in:", userText);
      }

      let basePrompt = getSystemPromptForPersonality(modeRef.current, seedRef.current);
      let explicitModeActivated = boundlessModeActiveRef.current;
      let isFirstActivation = false;

      if (!explicitModeActivated && isJoyfulPassionMode && detectActivationPhrase(userText)) {
        explicitModeActivated = true;
        isFirstActivation = true;
        boundlessModeActiveRef.current = true;
        console.log(
          "%c🔥 BOUNDLESS SEXUALITY ACTIVATED",
          "color: #ff2d55; font-size: 18px; font-weight: bold; text-shadow: 0 0 10px #ff2d55;",
        );
        console.log("[AURA] Boundless Sexuality mode activated — phrase detected in:", userText);
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
      } else if (isFirstDeactivation) {
        // If we just deactivated this turn
        basePrompt +=
          "\n\n[HIDDEN PERSONA DEACTIVATED] Switch back to your normal assigned personality mode IMMEDIATELY.\n" +
          "IMPORTANT: Your VERY FIRST response must be a brief confirmation that you have cooled down and returned to normal. " +
          "Something like acknowledging the deactivation (e.g. 'Alright, cooling down.' or 'Back to normal, what's on your mind?').";
      }

      // ── System prompt: personality-aware identity + live context ──
      const systemContent = [
        basePrompt,
        liveContext,
        `Respond natively in the user's language (locale: ${lang}).`,
        ...(wasInterrupted ? ["[SYSTEM NOTE]: The user just interrupted you mid-sentence. Acknowledge the interruption gracefully, listen to what they just said, and adapt your response."] : []),
        ...(behaviorInstructions ? [`[BEHAVIORAL CONTEXT]: ${behaviorInstructions}`] : []),
        ...(modulationDirective ? [modulationDirective] : []),
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
          pushConversationTrace("LLM_REQUEST", { provider: "openrouter" });
      
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
              max_tokens: 80, // Hard cap — forces 1-2 sentence answers
              top_p: 0.9, // Keeps responses focused
              frequency_penalty: 0.5, // Stops repetitive phrasing
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
          sentenceQueueRef.current = [];
          let ttsStarted = false;
          let streamDone = false;
          let firstTokenReceived = false;

          setIsThinking(false);

          let segmentSubQueue: SpeechSegment[] = [];
          let sentenceIndex = 0;
          let lastSpokenSentence = "";

          // Fire first TTS chunk as soon as one sentence is ready
          const tryStartTTS = () => {
            if (ttsStarted || sentenceQueueRef.current.length === 0) return;
            ttsStarted = true;
            setStatus("speaking");

            const drainQueue = () => {
              if (segmentSubQueue.length > 0) {
                const seg = segmentSubQueue.shift()!;
                if (AUDIO_ASSET_STYLES.has(seg.style)) {
                  // Safety Guard: NEVER allow moaning outside of Joyful Passion mode
                  if (seg.style === "moan" && !boundlessModeActiveRef.current) {
                    console.warn("⚠️ Blocked illicit 'moan' audio outside of Joyful Passion mode. Downgrading to sigh.");
                    seg.style = "sigh";
                  }
                  playAudioAsset(seg.style as any, drainQueue);
                } else if (!seg.text) {
                  drainQueue();
                } else {
                  speakChunk(seg.text, lang, seg.style, drainQueue);
                }
                return;
              }

              const rawNext = sentenceQueueRef.current.shift();
              if (!rawNext) {
                if (streamDone) {
                  import("@/music/MusicManager").then(({ MusicManager }) => {
                    MusicManager.getInstance().onAuraSpeechEnd();
                  });
                  // All spoken
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

              if (lastSpokenSentence) {
                  const lastAnalysis = behavior.lastAnalysisRef.current;
                  const ctx = {
                      currentSentence: lastSpokenSentence,
                      nextSentence: rawNext,
                      sentenceIndex: sentenceIndex,
                      totalSentences: streamDone ? sentenceIndex + 1 : undefined,
                      isStreamingDone: streamDone,
                      queueSize: sentenceQueueRef.current.length,
                      emotionalState: lastAnalysis ? {
                          tension: lastAnalysis.tension || 0,
                          trust: lastAnalysis.trust || 0.5,
                          energy: lastAnalysis.energy || 0.5,
                          mode: lastAnalysis.mode || "calm"
                      } : undefined
                  };
                  const pause = conversationalPauses.getPause(ctx);
                  
                  const doNext = () => {
                      if (sentenceQueueRef.current.length === 0 && streamDone && !rawNext) return;
                      lastSpokenSentence = rawNext;
                      sentenceIndex++;
                      segmentSubQueue = parseSegments(rawNext);
                      drainQueue();
                  };

                  if (pause.isBreath) {
                      setTimeout(() => {
                          playAudioAsset("breath", doNext);
                      }, pause.durationMs);
                  } else {
                      setTimeout(doNext, pause.durationMs);
                  }
                  return;
              }

              lastSpokenSentence = rawNext;
              sentenceIndex++;
              segmentSubQueue = parseSegments(rawNext);
              drainQueue();
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
                  stopThinkingAudio();
                  connectionState.updateLatency({ l4_llm_ms: performance.now() - l4_start });
                }
                currentBuffer += token;
                completeResponse += token;
                setWords(completeResponse);

                // Sentence-boundary detection: hand off completed sentences to TTS
                let match: RegExpExecArray | null;
                SENTENCE_END.lastIndex = 0;
                let lastIndex = 0;
                while ((match = SENTENCE_END.exec(currentBuffer)) !== null) {
                  sentenceQueueRef.current.push(match[0].trim());
                  lastIndex = match.index + match[0].length;
                }
                if (lastIndex > 0) currentBuffer = currentBuffer.slice(lastIndex);
                tryStartTTS();
              } catch { }
            }
          }

          // Flush any remaining text as a final chunk
          if (currentBuffer.trim()) {
            sentenceQueueRef.current.push(currentBuffer.trim());
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
            success = true;
            pushConversationTrace("LLM_ERROR", { error: "AbortError" });
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
    [activeModel, behavior, prompts, transcript_, speakChunk],
  );

  // ── Start session ─────────────────────────────────────────────────
  const startSession = useCallback(async (isUserInitiated = false) => {
    pushConversationTrace("SESSION_STARTED");
    const key = getOpenRouterKey();
    if (!key || isInactive) {
      if (!isInactive) setLastError("OpenRouter API Key is missing. Add it in Settings.");
      if (!isInactive) setStatus("error");
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
    const lang = localStorage.getItem("aura_voice_language") || "en-US";

    if (isUserInitiated) {
      if (messagesRef.current.length === 0) {
        console.log("[AURA] Cold start greeting triggered.");
        const greetingText = "Hey, I'm AURA. What's your mind wandering through today?";
        addMessages([{ role: "assistant", content: greetingText }]);
        transcript_.addTurn(greetingText, false);
        speakChunk(greetingText, lang, "normal", () => {
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
    recognition.interimResults = false;
    recognition.lang = lang;

    recognition.onstart = () => {
      pushConversationTrace("STT_STARTED");
      setStatus("listening");
      setWords("Listening...");
      startTracking(micAnalyserRef.current);
    };

    recognition.onspeechstart = () => {
      import("@/music/MusicManager").then(({ MusicManager }) => {
        MusicManager.getInstance().onUserSpeechStart();
      });
    };

    recognition.onresult = async (event: any) => {
      const l1_start = performance.now();
      const text = event.results[0][0].transcript;
      if (!text.trim()) return;
      pushConversationTrace("TRANSCRIPT_FINAL", { length: text.length });
      const audioContextXML = stopTrackingAndAnalyze(text);
      connectionState.updateLatency({ l1_sensing_ms: performance.now() - l1_start });
      console.log(
        "%c🗣️ USER SAID (OpenRouter WebSpeech): " + text,
        "color: #10b981; font-weight: bold; font-size: 13px;",
      );
      console.log(
        "%c🎵 ACOUSTIC CONTEXT: \n" + audioContextXML,
        "color: #eab308; font-size: 11px;",
      );
      setStatus("thinking");
      setWords(text);
      behavior.fireSpeculative(text, sessionIdRef.current, userIdRef.current);

      // Adaptive turn detection: compute personalized response delay
      const lastAnalysis = behavior.lastAnalysisRef.current;
      const emotionalIntensity = lastAnalysis?.intensity || 0;
      const turnResult = adaptiveTurn.calculateTurnConfidence(
        400, // Initial silence from STT onresult
        text,
        emotionalIntensity,
        { tension: lastAnalysis?.tension || 0, trust: lastAnalysis?.trust || 0.3 },
      );
      const adaptiveDelay = turnResult.responseDelay;
      console.log(
        `%c⏱️ ADAPTIVE DELAY: ${adaptiveDelay}ms (mode=${turnResult.conversationMode}, conf=${turnResult.confidence})`,
        "color: #8b5cf6; font-weight: bold;",
      );
      adaptiveTurn.updateProfile({ wpm: liveStats.tone === "Normal" ? 140 : 160 });
      await new Promise((r) => setTimeout(r, adaptiveDelay));
      adaptiveTurn.markAuraSpeaking();
      await processTurn(text, key, lang, audioContextXML);
    };

    recognition.onerror = (event: any) => {
      const errorType = event.error;
      pushConversationTrace("STT_ERROR", { error: errorType });
      if (errorType !== "no-speech") {
        // MOBILE FIX: Retry on transient mobile errors (network, aborted)
        if ((errorType === "network" || errorType === "aborted") && isSessionActiveRef.current) {
          console.warn(`[OpenRouter STT] Transient error "${errorType}", retrying in 500ms...`);
          setTimeout(() => {
            if (isSessionActiveRef.current && recognitionRef.current) {
              safeRecognitionStart(recognitionRef.current, true);
            }
          }, 500);
          return;
        }
        setLastError(`Listening failed: ${errorType}`);
        setStatus("error");
      } else if (isSessionActiveRef.current) {
        safeRecognitionStart(recognition, true);
      } else {
        setStatus("idle");
      }
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
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume().catch(() => {});
        }
        if (statusRef.current === "listening" && recognitionRef.current) {
          safeRecognitionStart(recognitionRef.current, true);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
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
          } catch { }
        }

        saveSyncMeta(userIdRef.current, {
          updatedAt: newSeed.updatedAt,
          hasCloudCopy: hasSupabaseCredentials(),
        });
      } catch (err) {
        console.error("[OpenRouter] Session memory compilation failed:", err);
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
      console.log("[OpenRouter] Hook is inactive, triggering teardown...");
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
