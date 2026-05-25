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
import { getCredential } from "@/lib/credentials";
import { useBehaviorInjection } from "../gemini/useBehaviorInjection";
import { usePromptOrchestrator } from "../gemini/usePromptOrchestrator";
import { useTranscriptManager } from "../gemini/useTranscript";
import { getSystemPromptForPersonality } from "@/lib/gemini-prompt";
import { JoyfulPassionSystemPrompt, isJoyfulPassionMode, detectActivationPhrase } from "../../modes/JoyfulPassionMode";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
import { getAdaptiveModulation } from "@/lib/adaptive-modulation";
import { transcribeAudio } from "./sarvamSTT";
import { generateSpeech } from "./sarvamTTS";

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
const SENTENCE_END = /[^.!?\n]+[.!?\n]+/g;

// Barge-in: fire if microphone RMS crosses this threshold while AURA speaks
const BARGE_IN_THRESHOLD = 0.018;

// Downsample PCM buffer to a target rate (e.g. 16kHz)
function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
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
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: "audio/wav" });
}

// ─── Hook ───────────────────────────────────────────────────────────
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
    Priya:  "priya",
    Kavya:  "kavya",
    Neha:   "neha",
    Shreya: "shreya",
    Ritu:   "ritu",
    // Male
    Shubh:  "shubh",
    Aditya: "aditya",
    Rahul:  "rahul",
    Dev:    "dev",
    Rohan:  "rohan",
    // ── Legacy Gemini aliases (backward compat) ──
    Puck:   "priya",
    Fenrir: "aditya",
    Kore:   "neha",
    Charon: "dev",
    Aoede:  "kavya",
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

  // Session control
  const isSessionActiveRef = useRef(false);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fallbackTranscriptRef = useRef<string>("");
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmSamplesRef = useRef<Float32Array[]>([]);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
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
  const transcript_ = useTranscriptManager();

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
    if (activeSourceRef.current) {
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
  };

  const speakChunkNative = useCallback(
    (text: string, lang: string, onDone?: () => void) => {
      if (isInactiveRef.current) {
        onDone?.();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
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
        isSpeakingRef.current = true;
        setStatus("speaking");
      };
      utterance.onend = () => {
        onDone?.();
      };
      utterance.onerror = () => {
        onDone?.();
      };
      window.speechSynthesis.speak(utterance);
    },
    [setStatus],
  );

  const speakChunk = useCallback(
    async (text: string, lang: string, onDone?: () => void) => {
      if (isInactiveRef.current) {
        onDone?.();
        return;
      }
      // R08 FIX: Read from ref so we always use the LATEST selected speaker,
      // even when this callback was captured by a stale closure.
      const currentSpeaker = speakerRef.current;
      console.log(`[Sarvam TTS] Speaking with voice: ${currentSpeaker}`);
      const base64 = await generateSpeech(text, currentSpeaker);
      if (!base64 || !audioCtxRef.current) {
        speakChunkNative(text, lang, onDone);
        return;
      }

      try {
        // R04 FIX: Use Uint8Array.from for cleaner allocation, and .slice(0)
        // to pass a COPY to decodeAudioData (prevents ArrayBuffer detach issues)
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bufferCopy = bytes.buffer.slice(0);
        const audioBuffer = await audioCtxRef.current.decodeAudioData(bufferCopy);
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtxRef.current.destination);

        source.onended = () => {
          activeSourceRef.current = null;
          // R06 FIX: Clear speaking state only when audio actually finishes
          isSpeakingRef.current = false;
          onDone?.();
        };

        activeSourceRef.current = source;
        // R06 FIX: Set speaking state only RIGHT BEFORE audio starts playing
        // (not before the network fetch), preventing false "speaking" UI
        isSpeakingRef.current = true;
        setStatus("speaking");
        source.start(0);
      } catch (e) {
        console.warn("[Sarvam TTS] Audio decode failed, falling back to native:", e);
        speakChunkNative(text, lang, onDone);
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

    const buf = new Float32Array(analyser.fftSize);
    const check = () => {
      if (!isSpeakingRef.current) return; // stop polling once TTS ends naturally
      analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      if (rms > BARGE_IN_THRESHOLD) {
        console.log(`[OpenRouter Voice] 🛑 Barge-in detected (RMS ${rms.toFixed(4)})`);
        onInterrupt();
        return;
      }
      bargeInFrameRef.current = requestAnimationFrame(check);
    };
    bargeInFrameRef.current = requestAnimationFrame(check);
  }, []);

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

  // ── Depth detection — decides if user wants a long, detailed answer ──
  const DEPTH_TRIGGERS = /\b(explain|detail|describe|elaborate|tell me (about|more)|how does|why does|what is|what are|can you (explain|describe|tell)|in depth|in detail|go on|keep going|continue|feelings?|feel about|think about|meaning of|history of|story|experience|share|express|opinion|perspective|explore|walk me through|break it down|deep dive)\b/i;

  const detectResponseDepth = (text: string): "deep" | "normal" => {
    // Long user messages (20+ words) often expect longer replies
    const wordCount = text.trim().split(/\s+/).length;
    if (DEPTH_TRIGGERS.test(text)) return "deep";
    if (wordCount >= 20) return "deep";
    // Questions with "why" or "how" tend to need fuller answers
    if (/^(why|how)\b/i.test(text.trim())) return "deep";
    return "normal";
  };

  // ── Core turn: SSE streaming + sentence-chunked TTS ──────────────
  const processTurn = useCallback(
    async (userText: string, apiKey: string, lang: string) => {
      setIsThinking(true);
      setStatus("thinking");
      setWords("AURA is perceiving...");

      // Record in canonical transcript
      transcript_.addTurn(userText, true);
      transcript_.turnCountRef.current += 1;

      // Append to OR message buffer
      const newMessages: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: userText },
      ];
      addMessages([{ role: "user", content: userText }]);

      // Behavioral analysis
      let behaviorInstructions = "";
      try {
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
      const depthDirective = responseDepth === "deep"
        ? "[RESPONSE LENGTH]: The user is asking for depth, explanation, or emotional expression. Respond with AT LEAST 5-6 full sentences. Be thorough, expressive, and complete. Do NOT cut short — give the user the full answer they're asking for."
        : "";
      const tokenLimit = responseDepth === "deep" ? 400 : 100;

      // ── System prompt: personality-aware identity + live context ──
      // ── Secret Personality Mode Activation (Bulletproof) ─────────────────
      // RULE: The explicit prompt is NEVER auto-injected. The user MUST say
      // the activation phrase "boundless sexuality" first. Once activated,
      // it persists for the rest of the session.
      let explicitModeActivated = boundlessModeActiveRef.current;
      let isFirstActivation = false;
      let basePrompt = getSystemPromptForPersonality(modeRef.current);

      if (!explicitModeActivated && isJoyfulPassionMode && detectActivationPhrase(userText)) {
        explicitModeActivated = true;
        isFirstActivation = true;
        boundlessModeActiveRef.current = true;
        console.log(
          "%c🔥 BOUNDLESS SEXUALITY ACTIVATED",
          "color: #ff2d55; font-size: 18px; font-weight: bold; text-shadow: 0 0 10px #ff2d55;"
        );
        console.log("[AURA/Sarvam] Boundless Sexuality mode activated — phrase detected in:", userText);
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
      }

      const systemContent = [
        basePrompt,
        liveContext,
        `Respond natively in the user's language (locale: ${lang}).`,
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
              stream: true,           // First word spoken ~600 ms
              temperature: 0.7,       // Natural word choice, not stiff
              max_tokens: tokenLimit,  // Dynamic: 100 for casual, 400 for depth
              top_p: 0.9,             // Keeps responses focused
              frequency_penalty: 0.5,  // Stops repetitive phrasing
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

          setIsThinking(false);

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
              if (isSessionActiveRef.current && startSessionRef.current) {
                startSessionRef.current();
              } else {
                setStatus("idle");
              }
            });

            const drainQueue = () => {
              const next = sentenceQueue.shift();
              if (!next) {
                if (streamDone) {
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
              speakChunk(next, lang, drainQueue);
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
                currentBuffer += token;
                completeResponse += token;
                setWords(completeResponse);

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
          tryStartTTS();
          success = true;
          break;
        } catch (e: any) {
          clearTimeout(fetchTimeout);
          if (e?.name === "AbortError") {
            // Barge-in or timeout aborted this fetch — treat as handled
            success = true;
            break;
          }
          console.warn(`[OpenRouter Voice] Model ${modelToTry} failed:`, e.message);
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
      }

      setIsThinking(false);
    },
    [activeModel, behavior, prompts, transcript_, speakChunk, startBargeInMonitor],
  );

  // ── Start session ─────────────────────────────────────────────────
  const startSession = useCallback(async () => {
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

    // Warm L2 cache + open mic analyser in parallel
    await Promise.all([prompts.warmL2Cache(), setupMicAnalyser()]);

    const lang = localStorage.getItem("aura_voice_language") || "en-US";
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

    // Custom WAV Recording stop/process logic
    const handleStopRecording = async () => {
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

      if (totalLength === 0 || duration < 600) {
        if (isSessionActiveRef.current) {
          setStatus("listening");
          setWords("Listening...");
          setTimeout(() => {
            if (isSessionActiveRef.current && recognitionRef.current) {
              try {
                recognitionRef.current.start();
              } catch {}
            }
          }, 300);
        }
        return;
      }

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

      const transcript = await transcribeAudio(wavBlob);
      const finalText = transcript || fallbackTranscriptRef.current;

      console.log("%c🎙️ SARVAM STT DIAGNOSTICS", "color: #8b5cf6; font-weight: bold; font-size: 14px;");
      console.log("├─ Sarvam Transcribed (saaras:v3):", transcript ? `"${transcript}"` : "[Empty/Failed]");
      console.log("├─ Fallback (Browser WebSpeech):", fallbackTranscriptRef.current ? `"${fallbackTranscriptRef.current}"` : "[Empty]");
      console.log("└─ Chosen Final Text:", `%c"${finalText}"`, "color: #8b5cf6; font-weight: bold;");

      // If both Sarvam STT and browser STT returned empty,
      // show feedback instead of silently going idle
      if (!finalText.trim()) {
        setWords("Couldn't hear that, try again...");
        setStatus("listening");
        // Auto-restart recognition after a brief delay
        setTimeout(() => {
          if (isSessionActiveRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {}
          }
        }, 500);
        return;
      }

      setStatus("thinking");
      setWords(finalText);
      behavior.fireSpeculative(finalText, sessionIdRef.current, userIdRef.current);
      await processTurn(finalText, key, lang);
    };

    recognition.onstart = () => {
      setStatus("listening");
      setWords("Listening...");
      pcmSamplesRef.current = [];
      fallbackTranscriptRef.current = "";
      recordingStartTimeRef.current = Date.now();

      const ctx = audioCtxRef.current;
      if (ctx && micAnalyserRef.current) {
        try {
          if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
          }
          const sp = ctx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = (e) => {
            if (isRecordingRef.current) {
              const input = e.inputBuffer.getChannelData(0);
              pcmSamplesRef.current.push(new Float32Array(input));
            }
          };
          micAnalyserRef.current.connect(sp);
          sp.connect(ctx.destination);
          scriptProcessorRef.current = sp;
          isRecordingRef.current = true;
        } catch (err) {
          console.warn("[Sarvam STT] Could not start WAV recording:", err);
        }
      }
    };

    recognition.onresult = (event: any) => {
      fallbackTranscriptRef.current = event.results[0][0].transcript;
      handleStopRecording();
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech") {
        setLastError(`Listening failed: ${event.error}`);
        setStatus("error");
      } else if (isSessionActiveRef.current) {
        try {
          recognition.start();
        } catch {}
      } else {
        setStatus("idle");
      }
      pcmSamplesRef.current = [];
      handleStopRecording();
    };

    recognition.onend = () => {
      if (isSessionActiveRef.current && statusRef.current === "listening") {
        try {
          recognition.start();
        } catch {}
      } else if (!isSessionActiveRef.current && statusRef.current === "listening") {
        setStatus("idle");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [behavior, prompts, processTurn, setupMicAnalyser]);

  // ── End session ───────────────────────────────────────────────────
  const endSession = useCallback(() => {
    isSessionActiveRef.current = false;
    boundlessModeActiveRef.current = false; // Reset activation on session end
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
  };
}
