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
import { getAdaptiveModulation } from "@/lib/adaptive-modulation";
import type { UserPresentation } from "@/lib/adaptive-modulation";
import type { ChatMessage } from "./types";
import { JoyfulPassionSystemPrompt, isJoyfulPassionMode, detectActivationPhrase, detectDeactivationPhrase } from "../../modes/JoyfulPassionMode";
import { useVoiceAcoustics } from "../../hooks/useVoiceAcoustics";

export type { ChatMessage };

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
  const isSessionActiveRef = useRef(false);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);

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
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
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

  // Brain sub-hooks (independently initialised — skip when inactive)
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
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
  };

  const speakChunk = useCallback((text: string, lang: string, onDone?: () => void) => {
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
  }, []);

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

  // ── Core turn: SSE streaming + sentence-chunked TTS ──────────────
  const processTurn = useCallback(
    async (userText: string, apiKey: string, lang: string, audioContextXML: string = "") => {
      setIsThinking(true);
      setStatus("thinking");
      setWords("AURA is perceiving...");

      // Record in canonical transcript
      transcript_.addTurn(userText, true);
      transcript_.turnCountRef.current += 1;

      // Append to OR message buffer with the invisible XML tag prepended
      const newMessages: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: audioContextXML + userText },
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
          "color: #3b82f6; font-size: 16px; font-weight: bold; text-shadow: 0 0 10px #3b82f6;"
        );
        console.log("[AURA] Mode deactivated — phrase detected in:", userText);
      }

      let basePrompt = getSystemPromptForPersonality(modeRef.current);
      let explicitModeActivated = boundlessModeActiveRef.current;
      let isFirstActivation = false;

      if (!explicitModeActivated && isJoyfulPassionMode && detectActivationPhrase(userText)) {
        explicitModeActivated = true;
        isFirstActivation = true;
        boundlessModeActiveRef.current = true;
        console.log(
          "%c🔥 BOUNDLESS SEXUALITY ACTIVATED",
          "color: #ff2d55; font-size: 18px; font-weight: bold; text-shadow: 0 0 10px #ff2d55;"
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
        basePrompt += "\n\n[HIDDEN PERSONA DEACTIVATED] Switch back to your normal assigned personality mode IMMEDIATELY.\n" +
          "IMPORTANT: Your VERY FIRST response must be a brief confirmation that you have cooled down and returned to normal. " +
          "Something like acknowledging the deactivation (e.g. 'Alright, cooling down.' or 'Back to normal, what's on your mind?').";
      }

      // ── System prompt: personality-aware identity + live context ──
      const systemContent = [
        basePrompt,
        liveContext,
        `Respond natively in the user's language (locale: ${lang}).`,
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
              temperature: 0.7, // Natural word choice, not stiff
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

    recognition.onstart = () => {
      setStatus("listening");
      setWords("Listening...");
      startTracking(micAnalyserRef.current);
    };

    recognition.onresult = async (event: any) => {
      const text = event.results[0][0].transcript;
      if (!text.trim()) return;
      const audioContextXML = stopTrackingAndAnalyze(text);
      console.log("%c🗣️ USER SAID (OpenRouter WebSpeech): " + text, "color: #10b981; font-weight: bold; font-size: 13px;");
      console.log("%c🎵 ACOUSTIC CONTEXT: \n" + audioContextXML, "color: #eab308; font-size: 11px;");
      setStatus("thinking");
      setWords(text);
      behavior.fireSpeculative(text, sessionIdRef.current, userIdRef.current);
      // Artificial hold: let the user finish their thought before generating
      await new Promise((r) => setTimeout(r, 400));
      await processTurn(text, key, lang, audioContextXML);
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
