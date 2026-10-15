import { useRef, useState, useCallback, useEffect } from "react";
import { GeminiVoiceEngine } from "./GeminiVoiceEngine";
import { GeminiSessionState, VoiceEngineConfig } from "./GeminiTypes";
import {
  SessionReadinessManager,
  ReadinessSnapshot,
  ReadinessErrorCode,
} from "./SessionReadinessManager";
import { getGeminiKey } from "@/lib/api";
import { VoiceHealthWatchdog } from "./VoiceHealthWatchdog";

export interface GeminiVoiceAdapterState {
  status:
    | "idle"
    | "connecting"
    | "listening"
    | "processing"
    | "speaking"
    | "error"
    | "reconnecting";
  isSpeaking: boolean;
  isThinking: boolean;
  words: string;
  lastError: string | null;
  readinessSnapshot: ReadinessSnapshot | null;
  getInputFrequencyData: () => Uint8Array;
  getOutputFrequencyData: () => Uint8Array;
  startSession: (systemInstruction: string, tools: any[], voice: string) => Promise<void>;
  endSession: () => Promise<void>;
  sendText: (text: string) => void;
  requestAutonomousResponse: (text: string) => boolean;
  cancelAutonomousResponse: () => void;
  /** Injects internal cognition without triggering a model response. */
  injectContext: (text: string) => void;
  muteMicrophone: () => void;
  unmuteMicrophone: () => void;
  setOutputVolume: (gain: number) => void;
  engine: GeminiVoiceEngine | null;
}

export function useGeminiVoiceAdapter(options: {
  onTurnComplete?: (
    userText: string,
    modelText: string,
    turnId?: string,
    turnNonce?: number,
  ) => void;
  onToolCall?: (toolCall: any) => Promise<any>;
  onInterruption?: (
    userText: string,
    modelText: string,
    turnId?: string,
    turnNonce?: number,
  ) => void;
  onInputTranscription?: (text: string) => void;
  onOutputTranscription?: (text: string) => void;
  onAuraSpeechStart?: () => void;
  onUserSpeechDetected?: () => void;
  onUsageMetadata?: (meta: any) => void;
}): GeminiVoiceAdapterState {
  const engineRef = useRef<GeminiVoiceEngine | null>(null);
  const readinessRef = useRef<SessionReadinessManager | null>(null);
  const watchdogRef = useRef<VoiceHealthWatchdog | null>(null);

  const [status, setStatus] = useState<GeminiVoiceAdapterState["status"]>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [words, setWords] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const lastAuthErrorRef = useRef<string | null>(null);
  const [readinessSnapshot, setReadinessSnapshot] = useState<ReadinessSnapshot | null>(null);

  const currentUserTextRef = useRef("");
  const currentModelTextRef = useRef("");
  const currentTurnIdRef = useRef<string | null>(null);
  const turnNonceCounterRef = useRef(0);

  const recoveryAttemptsRef = useRef(0);
  const MAX_RECOVERY_ATTEMPTS = 3;
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastConfigRef = useRef<{ systemInstruction: string; tools: any[]; voice: string } | null>(
    null,
  );

  const handleRecovery = useCallback(async (isCritical: boolean = false) => {
    const attempts = recoveryAttemptsRef.current;

    // Auth errors are non-retryable (speech contract: retryable=false for auth).
    // Retrying with the same invalid/expired key just burns recovery attempts.
    if (lastAuthErrorRef.current) {
      console.warn(
        "[GeminiVoiceAdapter] Skipping recovery — credential error is non-retryable. User must update their key.",
      );
      setStatus("error");
      setLastError(lastAuthErrorRef.current);
      return;
    }

    // If visible, enforce MAX_RECOVERY_ATTEMPTS. If hidden, bypass to allow infinite slow polling.
    if (document.visibilityState !== "hidden" && attempts >= MAX_RECOVERY_ATTEMPTS) {
      setStatus("error");
      setLastError("Connection failed after multiple recovery attempts.");
      return;
    }

    recoveryAttemptsRef.current++;
    setStatus("reconnecting");

    let backoffMs = Math.min(1000 * Math.pow(2, attempts), 30000); // 1s, 2s, 4s, 8s... up to 30s

    if (document.visibilityState === "hidden") {
      backoffMs = 10000; // Poll slowly every 10s indefinitely while screen is off
    }

    // Clear stale turn state so recovery doesn't replay an interrupted turn
    currentUserTextRef.current = "";
    currentModelTextRef.current = "";
    currentTurnIdRef.current = null;

    if (engineRef.current) {
      await engineRef.current.stop();
      await new Promise((r) => setTimeout(r, backoffMs));
      try {
        await engineRef.current.start();
        // Reset watchdog stall baseline after successful reconnect
        if (watchdogRef.current) {
          watchdogRef.current.resetStallBaseline();
        }
      } catch (e: any) {
        // engine.start() already surfaced the error via onError → readiness.
        // If it was an auth error, recovery is now permanently gated.
        setStatus("error");
      }
    }
  }, []);

  const endSession = useCallback(async () => {
    if (recoveryTimeoutRef.current) clearTimeout(recoveryTimeoutRef.current);
    if (stableTimeoutRef.current) clearTimeout(stableTimeoutRef.current);

    if (watchdogRef.current) {
      watchdogRef.current.stop();
      watchdogRef.current = null;
    }

    lastAuthErrorRef.current = null;

    if (readinessRef.current) {
      readinessRef.current.dispose();
      readinessRef.current = null;
    }
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }
    setStatus("idle");
    setIsSpeaking(false);
    setIsThinking(false);
    setWords("");
    setReadinessSnapshot(null);
    currentUserTextRef.current = "";
    currentModelTextRef.current = "";
  }, []);

  const startSession = useCallback(
    async (systemInstruction: string, tools: any[], voice: string, isRecovery = false) => {
      if (!isRecovery) {
        recoveryAttemptsRef.current = 0;
        lastAuthErrorRef.current = null;
        lastConfigRef.current = { systemInstruction, tools, voice };
      }

      await endSession();

      setLastError(null);
      setStatus("connecting");
      setWords("Listening...");

      // Create readiness manager
      const readiness = new SessionReadinessManager();
      readinessRef.current = readiness;
      readiness.onUpdate((snapshot) => {
        setReadinessSnapshot({ ...snapshot });
      });
      readiness.begin();

      // 1. Credential check
      readiness.markInProgress("credentials");
      const apiKey = getGeminiKey();
      if (!apiKey) {
        readiness.markFailed("credentials", "MISSING_CREDENTIAL");
        setLastError("Missing Gemini API Key");
        setStatus("error");
        return;
      }
      readiness.markComplete("credentials");

      const config: VoiceEngineConfig = {
        apiKey,
        model: "models/gemini-3.1-flash-live-preview",
        voice: voice,
        systemInstruction: systemInstruction,
      };

      const engine = new GeminiVoiceEngine(config, {
        onStateChange: (state: GeminiSessionState) => {
          console.log(`[GeminiVoiceAdapter] Engine state transitioned to: ${state}`);
          switch (state) {
            case "IDLE":
              setStatus("idle");
              break;
            case "CONNECTING":
              setStatus(isRecovery ? "reconnecting" : "connecting");
              break;
            case "CONNECTED":
              setStatus("listening");
              watchdogRef.current?.start();
              // Reset recovery attempts after 30s of stable connection
              if (stableTimeoutRef.current) clearTimeout(stableTimeoutRef.current);
              stableTimeoutRef.current = setTimeout(() => {
                recoveryAttemptsRef.current = 0;
              }, 30000);
              break;
            case "ERROR":
              setStatus("error");
              break;
            case "CLOSED":
              setStatus("idle");
              watchdogRef.current?.stop();
              break;
          }
        },
        onModelText: (text: string) => {
          if (!currentTurnIdRef.current) {
            currentTurnIdRef.current = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          }
          setIsThinking(false);
          setIsSpeaking(true);
          setStatus("speaking");
          currentModelTextRef.current += text;
        },
        onOutputTranscription: (text: string) => {
          // With responseModalities AUDIO, AURA's words come back as output
          // transcription (modelTurn text parts do not carry speech). Without
          // accumulating it, interrupted turns record empty model text and the
          // archive loses the basis for repetition analysis.
          if (!currentTurnIdRef.current) {
            currentTurnIdRef.current = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          }
          setIsThinking(false);
          setIsSpeaking(true);
          setStatus("speaking");
          currentModelTextRef.current += text;
          if (options.onOutputTranscription) {
            options.onOutputTranscription(text);
          }
        },
        onInputTranscription: (text: string) => {
          if (!currentTurnIdRef.current) {
            currentTurnIdRef.current = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          }
          currentUserTextRef.current += text + " ";
          setWords(currentUserTextRef.current);
          if (options.onInputTranscription) {
            options.onInputTranscription(text);
          }
        },
        onTurnComplete: () => {
          setIsSpeaking(false);
          setStatus("listening");

          const userTxt = currentUserTextRef.current.trim();
          const modelTxt = currentModelTextRef.current.trim();
          const turnId = currentTurnIdRef.current ?? undefined;
          const turnNonce = turnNonceCounterRef.current;

          if (options.onTurnComplete && (userTxt || modelTxt)) {
            options.onTurnComplete(userTxt, modelTxt, turnId, turnNonce);
          }

          currentUserTextRef.current = "";
          currentModelTextRef.current = "";
          currentTurnIdRef.current = null;
          turnNonceCounterRef.current++;
          setWords("");
        },
        onToolCall: async (calls: any[]) => {
          if (options.onToolCall && calls.length > 0) {
            const resps = [];
            for (const call of calls) {
              const res = await options.onToolCall(call);
              resps.push({
                id: call.id,
                name: call.name,
                response: res,
              });
            }
            return resps;
          }
          return [];
        },
        onInterrupted: () => {
          const userTxt = currentUserTextRef.current.trim();
          const modelTxt = currentModelTextRef.current.trim();
          const turnId = currentTurnIdRef.current ?? undefined;
          const turnNonce = turnNonceCounterRef.current;
          if (options.onInterruption) {
            options.onInterruption(userTxt, modelTxt, turnId, turnNonce);
          }
          currentUserTextRef.current = "";
          currentModelTextRef.current = "";
          currentTurnIdRef.current = null;
          turnNonceCounterRef.current++;
          setWords("");
          setIsSpeaking(false);
          setStatus("listening");
        },
        onAuraSpeechStart: () => {
          if (options.onAuraSpeechStart) {
            options.onAuraSpeechStart();
          }
        },
        onUserSpeechDetected: () => {
          if (options.onUserSpeechDetected) {
            options.onUserSpeechDetected();
          }
        },
        onUsageMetadata: (meta: any) => {
          if (options.onUsageMetadata) {
            options.onUsageMetadata(meta);
          }
        },
        onMilestone: (id, milestoneStatus, error) => {
          if (!readinessRef.current) return;
          switch (milestoneStatus) {
            case "in_progress":
              readinessRef.current.markInProgress(id);
              break;
            case "complete":
              readinessRef.current.markComplete(id);
              break;
            case "failed":
              readinessRef.current.markFailed(id, "UNKNOWN" as ReadinessErrorCode, error);
              break;
          }
        },
        onError: (err: any) => {
          const errorMsg = err.message || String(err);
          if (isAuthError(errorMsg)) {
            const friendly = friendlyAuthMessage();
            lastAuthErrorRef.current = friendly;
            setLastError(friendly);
          } else {
            setLastError(errorMsg);
          }
          // If we're still initializing, mark the current in-progress milestone as failed
          if (readinessRef.current) {
            const snapshot = readinessRef.current.getSnapshot();
            if (snapshot.overall === "initializing") {
              const inProgress = snapshot.milestones.find((m) => m.status === "in_progress");
              if (inProgress) {
                const errorCode = classifyError(inProgress.id, errorMsg);
                readinessRef.current.markFailed(inProgress.id, errorCode, errorMsg);
              }
            }
          }
        },
      });
      watchdogRef.current = new VoiceHealthWatchdog(engine, (reason) => {
        console.warn(`[GeminiVoiceAdapter] Watchdog triggered recovery for reason: ${reason}`);
        handleRecovery(true);
      });
      engineRef.current = engine;

      try {
        await engine.start();
      } catch (e: any) {
        const msg = e.message || String(e);
        if (isAuthError(msg)) {
          const friendly = friendlyAuthMessage();
          lastAuthErrorRef.current = friendly;
          setLastError(friendly);
        } else {
          setLastError(e.message);
        }
        setStatus("error");
        // Engine errors are already routed through onError → readiness
      }
    },
    [endSession, options],
  );

  const sendText = useCallback((text: string) => {
    if (engineRef.current) {
      engineRef.current.sendText(text);
    }
  }, []);

  const injectContext = useCallback((text: string) => {
    if (engineRef.current) {
      engineRef.current.injectContext(text);
    }
  }, []);

  const muteMicrophone = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.muteMicrophone();
    }
  }, []);

  const unmuteMicrophone = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.unmuteMicrophone();
    }
  }, []);

  const setOutputVolume = useCallback((gain: number) => {
    if (engineRef.current) {
      engineRef.current.setOutputVolume(gain);
    }
  }, []);

  const getInputFrequencyData = useCallback(() => {
    return engineRef.current?.getInputFrequencyData() || new Uint8Array(32);
  }, []);

  const getOutputFrequencyData = useCallback(() => {
    return engineRef.current?.getOutputFrequencyData() || new Uint8Array(32);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recoveryTimeoutRef.current) clearTimeout(recoveryTimeoutRef.current);
      if (stableTimeoutRef.current) clearTimeout(stableTimeoutRef.current);
      if (readinessRef.current) {
        readinessRef.current.dispose();
        readinessRef.current = null;
      }
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }
    };
  }, []);

  return {
    status,
    isSpeaking,
    isThinking,
    words,
    lastError,
    readinessSnapshot,
    getInputFrequencyData,
    getOutputFrequencyData,
    startSession,
    endSession,
    sendText,
    requestAutonomousResponse: (instruction: string) => {
      const accepted = engineRef.current?.requestAutonomousResponse(instruction) ?? false;
      if (accepted) {
        setIsThinking(true);
        setStatus("processing");
      }
      return accepted;
    },
    cancelAutonomousResponse: () => {
      engineRef.current?.cancelAutonomousResponse();
      // Cancelled output is not archived as a completed response.
      currentModelTextRef.current = "";
      setIsThinking(false);
      setIsSpeaking(false);
      setStatus("listening");
    },
    injectContext,
    muteMicrophone,
    unmuteMicrophone,
    setOutputVolume,
    engine: engineRef.current,
  };
}

/** Classify an error message into a readiness error code based on the milestone context */
function classifyError(milestoneId: string, message: string): ReadinessErrorCode {
  const lower = message.toLowerCase();

  if (lower.includes("permission") || lower.includes("notallowederror")) {
    return "PERMISSION_DENIED";
  }
  if (
    lower.includes("notfounderror") ||
    lower.includes("no device") ||
    lower.includes("no microphone")
  ) {
    return "MICROPHONE_UNAVAILABLE";
  }
  if (lower.includes("audiocontext") || lower.includes("audio context")) {
    return "AUDIO_CONTEXT_FAILED";
  }
  if (
    lower.includes("billing") ||
    lower.includes("1008") ||
    lower.includes("prepaid") ||
    lower.includes("credential") ||
    lower.includes("authentication") ||
    lower.includes("api key") ||
    lower.includes("apikey") ||
    lower.includes("auth")
  ) {
    return "GEMINI_CONNECTION_FAILED";
  }

  switch (milestoneId) {
    case "microphone":
      return "MICROPHONE_UNAVAILABLE";
    case "audio_output":
      return "OUTPUT_INITIALIZATION_FAILED";
    case "gemini_session":
      return "GEMINI_CONNECTION_FAILED";
    case "input_path":
      return "PCM_CAPTURE_FAILED";
    case "output_path":
      return "OUTPUT_INITIALIZATION_FAILED";
    default:
      return "UNKNOWN";
  }
}

/**
 * Detect Google auth/credential rejections. These are non-retryable:
 * the key is invalid, expired (AQ.Ab AI Studio keys are ephemeral), or revoked.
 * Recovery must fail fast and prompt the user to update their key.
 */
export function isAuthError(message: string): boolean {
  const lower = (message || "").toLowerCase();
  return (
    lower.includes("invalid authentication credential") ||
    lower.includes("oauth 2 access token") ||
    lower.includes("login cookie") ||
    lower.includes("api key not valid") ||
    lower.includes("api_key_not_valid") ||
    lower.includes("unauthenticated") ||
    lower.includes("401") ||
    lower.includes("permission denied: consumer")
  );
}

/** Friendly user-facing message for auth rejections. */
function friendlyAuthMessage(): string {
  return "Your Gemini API key is invalid or expired. AI Studio keys (AQ.Ab...) expire — open Settings and paste a fresh key.";
}
