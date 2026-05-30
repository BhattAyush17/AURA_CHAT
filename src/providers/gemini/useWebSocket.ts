/**
 * useGeminiWebSocket — WebSocket connection lifecycle for Gemini Live API.
 *
 * Handles: connect with model cascade, disconnect, reconnect with backoff,
 * message routing via callbacks, heartbeat keepalive, and visibility-based
 * suspend/resume.
 *
 * @module
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { emitLatency } from "@/components/LatencyMeter";
import { getSystemPromptForPersonality } from "@/lib/gemini-prompt";
import { getGeminiKey } from "@/lib/api";
import { LIVE_MODELS, isModelRejection, float32ToBase64Pcm, WORKLET_PATH } from "./types";
import { LiveSession, SessionState, UIStatus, PerfTimings } from "./types";
import { useMountContract } from "./useMountContract";
import { useReconnectPolicy } from "./useReconnect";
import { transition, WSState } from "./useStateMachine";

const MAX_RECONNECT_ATTEMPTS = 10;

// ─── Types ──────────────────────────────────────────────────────────

export interface GeminiMessageCallbacks {
  onAudio: (base64Data: string) => void;
  onModelText: (text: string) => void;
  onInputTranscription: (text: string) => void;
  onToolCall: (functionCalls: any[]) => any[];
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onUsageMetadata: (meta: any) => void;
  onServerContent: () => void;
}

export interface GeminiWebSocketAPI {
  sessionRef: React.MutableRefObject<LiveSession | null>;
  sessionState: React.MutableRefObject<SessionState>;
  isSessionReadyRef: React.MutableRefObject<boolean>;
  perfRef: React.MutableRefObject<PerfTimings>;
  firstTokenEmitted: React.MutableRefObject<boolean>;
  userApiKeyRef: React.MutableRefObject<string>;

  connectionState: string;
  reconnectionAttempt: number;
  isRecovering: boolean;

  connect: (opts: {
    voice: string;
    voiceLanguage: string;
    personality?: string;
    seedBlock?: string;
    setupAudio: (stream: MediaStream) => Promise<AudioContext>;
    onOpen: (session: LiveSession, audioContext: AudioContext, stream: MediaStream) => void;
    messageCallbacks: GeminiMessageCallbacks;
    onStatusChange: (status: UIStatus) => void;
    onError: (error: string) => void;
    teardown: () => void;
  }) => Promise<void>;

  disconnect: () => void;
  sendClientContent: (payload: any) => void;
  sendRealtimeInput: (data: any) => void;
  updateConfig: (voice: string) => void;
}

// ─── The Hook ───────────────────────────────────────────────────────

export function useGeminiWebSocket(): GeminiWebSocketAPI {
  const sessionRef = useRef<LiveSession | null>(null);
  const sessionState = useRef<SessionState>("idle");
  const isSessionReadyRef = useRef(false);
  const firstTokenEmitted = useRef(false);
  const userApiKeyRef = useRef("");

  const currentModelIndexRef = useRef(0);
  const isCascadingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userClosedRef = useRef(false);
  const [connectionState, setConnectionState] = useState<string>("idle");
  const [reconnectionAttempt, setReconnectionAttempt] = useState<number>(0);
  const [isRecovering, setIsRecovering] = useState<boolean>(false);

  const { guardCallback } = useMountContract();
  const { shouldReconnect, nextDelay, reset } = useReconnectPolicy();
  const wsState = useRef<WSState>("IDLE");

  const setInternalState = useCallback((state: string) => {
    setConnectionState(state);
    sessionState.current = state as any;
  }, []);

  const conversationTurnsRef = useRef<{ role: "user" | "model"; text: string }[]>([]);
  const lastBehavioralLayerRef = useRef<any>(null);
  const audioBufferRef = useRef<{ time: number; data: any }[]>([]);
  const isAuraSpeakingRef = useRef(false);
  const isUserSpeakingRef = useRef(false);
  const lastMessageReceivedAtRef = useRef<number>(Date.now());
  const pingSentAtRef = useRef<number>(0);

  const perfRef = useRef<PerfTimings>({
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
  });

  const connectRef = useRef<() => Promise<void>>(async () => {});
  const lastOptsRef = useRef<any>(null);

  const sendClientContent = useCallback((payload: any) => {
    if (sessionRef.current) {
      if (payload?.turns?.length) {
        lastBehavioralLayerRef.current = payload;
      }
      (sessionRef.current as any).sendClientContent(payload);
    }
  }, []);

  const sendRealtimeInput = useCallback((data: any) => {
    if (sessionRef.current) {
      sessionRef.current.sendRealtimeInput(data);
    }
    isUserSpeakingRef.current = true;
    audioBufferRef.current.push({ time: Date.now(), data });
    const cutoff = Date.now() - 5000;
    while (audioBufferRef.current.length > 0 && audioBufferRef.current[0].time < cutoff) {
      audioBufferRef.current.shift();
    }
  }, []);

  const disconnect = useCallback(() => {
    userClosedRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptsRef.current = 0;
    setReconnectionAttempt(0);
    currentModelIndexRef.current = 0;
    isCascadingRef.current = false;
    if (sessionRef.current) {
      try {
        wsState.current = transition(wsState.current, "CLOSING");
        sessionRef.current.close?.();
        wsState.current = transition(wsState.current, "CLOSED");
      } catch {}
      sessionRef.current = null;
    }
    isSessionReadyRef.current = false;
    setInternalState("disconnected");
    reset();
  }, [setInternalState, reset]);

  const connect = useCallback(
    async (opts?: {
      voice: string;
      voiceLanguage: string;
      personality?: string;
      seedBlock?: string;
      setupAudio: (stream: MediaStream) => Promise<AudioContext>;
      onOpen: (session: LiveSession, audioContext: AudioContext, stream: MediaStream) => void;
      messageCallbacks: GeminiMessageCallbacks;
      onStatusChange: (status: UIStatus) => void;
      onError: (error: string) => void;
      teardown: () => void;
    }) => {
      if (sessionState.current === "connecting" || sessionState.current === "connected") return;

      if (opts) {
        lastOptsRef.current = opts;
      }
      const activeOpts = opts || lastOptsRef.current;
      if (!activeOpts) {
        console.error("[AURA] Cannot connect: missing options.");
        return;
      }

      if (!isCascadingRef.current) {
        currentModelIndexRef.current = 0;
      }

      if (currentModelIndexRef.current >= LIVE_MODELS.length) {
        console.error("[AURA] All models in cascade exhausted.");
        isCascadingRef.current = false;
        setInternalState("failed");
        activeOpts.onStatusChange("error");
        activeOpts.onError(
          "No compatible Live API model found. Please ensure your Google AI Studio project is on the Paid Tier with billing enabled and a positive prepaid balance ($10 minimum), as Google restricts the real-time WebSocket Live API to billing-enabled accounts.",
        );
        return;
      }

      const targetModel = LIVE_MODELS[currentModelIndexRef.current];
      const isNativeAudio = targetModel.includes("gemini-2.0");
      console.log(
        `[AURA] Connecting... model [${currentModelIndexRef.current + 1}/${LIVE_MODELS.length}]: ${targetModel}`,
      );

      wsState.current = transition(wsState.current, "CONNECTING");
      setInternalState("connecting");
      if (!isCascadingRef.current) activeOpts.onStatusChange("connecting");
      userClosedRef.current = false;

      const connectTimeoutId = setTimeout(
        guardCallback(() => {
          if (sessionState.current === "connecting") {
            activeOpts.teardown();
            wsState.current = transition(wsState.current, "CLOSED");
            setInternalState("disconnected");
            activeOpts.onStatusChange("idle");
            activeOpts.onError(
              "Connection timed out. Check your internet connection or API key and try again.",
            );
          }
        }),
        12000,
      );

      activeOpts.teardown();

      try {
        const apiKey = getGeminiKey();
        if (!apiKey || apiKey.trim().length < 10) {
          throw new Error("Invalid or missing GEMINI_API_KEY. Configure it in Settings.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000,
            channelCount: 1,
          },
        });
        const audioContext = await activeOpts.setupAudio(stream);
        const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });

        let session: any;
        let onOpenResolve: (() => void) | null = null;
        const onOpenPromise = new Promise<void>((r) => {
          onOpenResolve = r;
        });
        const connectStart = performance.now();
        perfRef.current.connectStart = connectStart;
        perfRef.current.t1 = connectStart;

        try {
          session = await ai.live.connect({
            model: targetModel,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: activeOpts.voice } },
                ...(isNativeAudio ? {} : { languageCode: activeOpts.voiceLanguage }),
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false,
                  startOfSpeechSensitivity: "START_SENSITIVITY_HIGH" as any,
                  endOfSpeechSensitivity: "END_SENSITIVITY_LOW" as any,
                  prefixPaddingMs: 20,
                  silenceDurationMs: 1300, // Was 500 — raised to prevent cutting users off mid-thought
                },
              },
              systemInstruction: {
                parts: [
                  {
                    text: getSystemPromptForPersonality(
                      activeOpts.personality,
                      activeOpts.seedBlock,
                    ),
                  },
                ],
              },
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: "saveMemory",
                      parameters: {
                        type: Type.OBJECT,
                        properties: { fact: { type: Type.STRING } },
                        required: ["fact"],
                      },
                    },
                    {
                      name: "updateAnalysis",
                      parameters: {
                        type: Type.OBJECT,
                        properties: {
                          user_words: { type: Type.STRING },
                          detected_tone: { type: Type.STRING },
                          perceived_intent: { type: Type.STRING },
                        },
                        required: ["user_words", "detected_tone", "perceived_intent"],
                      },
                    },
                  ],
                },
              ],
            },
            callbacks: {
              onopen: guardCallback(() => {
                clearTimeout(connectTimeoutId);
                const setupLatency = performance.now() - perfRef.current.connectStart;
                perfRef.current.geminiSetup = setupLatency;
                emitLatency({
                  geminiConnect: performance.now() - connectStart,
                  geminiSetup: setupLatency,
                });
                console.log(`[AURA] ✓ Connected to ${targetModel}`);

                firstTokenEmitted.current = false;
                isCascadingRef.current = false;
                wsState.current = transition(wsState.current, "CONNECTED");
                setInternalState("connected");
                activeOpts.onStatusChange("listening");
                onOpenResolve?.();
              }),

              onmessage: guardCallback((message: any) => {
                const msg = message as any;
                lastMessageReceivedAtRef.current = Date.now();

                if (msg.goAway) {
                  console.warn("[AURA] Server sent goAway, time left:", msg.goAway.timeLeft);
                  userClosedRef.current = false;
                  sessionRef.current?.close?.();
                  return;
                }

                if (msg.serverContent) {
                  activeOpts.messageCallbacks.onServerContent();
                  if (!firstTokenEmitted.current) {
                    emitLatency("firstToken", performance.now() - perfRef.current.t3);
                    firstTokenEmitted.current = true;
                  }
                }

                if (msg.usageMetadata)
                  activeOpts.messageCallbacks.onUsageMetadata(msg.usageMetadata);

                if (msg.toolCall?.functionCalls) {
                  const resps = activeOpts.messageCallbacks.onToolCall(msg.toolCall.functionCalls);
                  const activeSession = sessionRef.current as any;
                  if (activeSession?.sendToolResponse) {
                    activeSession.sendToolResponse({ functionResponses: resps });
                  } else if (activeSession) {
                    activeSession.sendClientContent({ toolResponse: { functionResponses: resps } });
                  }
                }

                if (msg.serverContent?.inputTranscription?.text) {
                  activeOpts.messageCallbacks.onInputTranscription(
                    msg.serverContent.inputTranscription.text,
                  );
                  conversationTurnsRef.current.push({
                    role: "user",
                    text: msg.serverContent.inputTranscription.text,
                  });
                  if (conversationTurnsRef.current.length > 3) conversationTurnsRef.current.shift();
                  isUserSpeakingRef.current = false;
                }

                if (msg.serverContent?.modelTurn?.parts) {
                  const textPart = msg.serverContent.modelTurn.parts.find((p: any) => p.text);
                  if (textPart) {
                    activeOpts.messageCallbacks.onModelText(textPart.text);
                    conversationTurnsRef.current.push({ role: "model", text: textPart.text });
                    if (conversationTurnsRef.current.length > 3)
                      conversationTurnsRef.current.shift();
                  }

                  const audioPart = msg.serverContent.modelTurn.parts.find(
                    (p: any) => p.inlineData?.data,
                  );
                  if (audioPart) {
                    activeOpts.messageCallbacks.onAudio(audioPart.inlineData.data);
                    isAuraSpeakingRef.current = true;
                  }
                }

                if (msg.serverContent?.turnComplete) {
                  activeOpts.messageCallbacks.onTurnComplete();
                  isAuraSpeakingRef.current = false;
                }

                if (msg.serverContent?.interrupted) {
                  activeOpts.messageCallbacks.onInterrupted();
                  isAuraSpeakingRef.current = false;
                  
                  // Gracefully transition back to listening and clear turn state
                  // rather than waiting for a turnComplete that will never come.
                  activeOpts.messageCallbacks.onTurnComplete();
                  activeOpts.onStatusChange("listening");
                }
              }),

              onclose: guardCallback((event: any) => {
                const code: number | undefined = event?.code;
                const reason: string | undefined = event?.reason ?? "";
                console.error(`[AURA_API_FAIL] ⚠️ WebSocket CLOSED.`, {
                  code,
                  reason,
                  wasClean: event?.wasClean,
                });
                isSessionReadyRef.current = false;
                if (sessionState.current === "idle" || userClosedRef.current) {
                  wsState.current = transition(wsState.current, "CLOSED");
                  return;
                }

                if (isModelRejection(code, reason, "")) {
                  console.warn(
                    `[AURA] Model ${targetModel} rejected (Code: ${code}, Reason: ${reason}). Trying next model in cascade...`,
                  );
                  currentModelIndexRef.current++;
                  isCascadingRef.current = true;
                  wsState.current = transition(wsState.current, "CLOSED");
                  setInternalState("disconnected");
                  setTimeout(
                    guardCallback(() => connect(activeOpts)),
                    50,
                  );
                  return;
                }

                if (shouldReconnect(code ?? 0)) {
                  wsState.current = transition(wsState.current, "RECONNECTING");
                  setInternalState("reconnecting");
                  activeOpts.onStatusChange("reconnecting");

                  reconnectTimerRef.current = setTimeout(
                    guardCallback(() => {
                      if (!userClosedRef.current) {
                        // C5 FIX: Reset to IDLE before reconnect — RECONNECTING→CONNECTING is illegal
                        wsState.current = transition(wsState.current, "IDLE");
                        reconnectAttemptsRef.current++;
                        setReconnectionAttempt(reconnectAttemptsRef.current);
                        connectRef.current();
                      }
                    }),
                    nextDelay(),
                  );
                } else {
                  wsState.current = transition(wsState.current, "CLOSED");
                  setInternalState("failed");
                  activeOpts.onStatusChange("error");
                  if (code === 1008) {
                    activeOpts.onError(
                      `Connection closed by Google (Code: 1008 - Policy/Billing). ${reason ? `Reason: "${reason}". ` : ""}The Gemini Live API requires a Paid Tier project with billing enabled and a positive prepay balance of at least $10. Please check your Google AI Studio billing status.`,
                    );
                  } else {
                    activeOpts.onError(
                      `Could not maintain connection (Code: ${code})${reason ? `. Reason: "${reason}"` : ""}`,
                    );
                  }
                  reset();
                }
              }),

              onerror: guardCallback((err: unknown) => {
                const errMsg =
                  err instanceof Error
                    ? err.message
                    : typeof err === "string"
                      ? err
                      : "Connection error occurred.";
                console.error(`[AURA_API_FAIL] ⚠️ WebSocket ERROR:`, errMsg);
                activeOpts.onError(errMsg);
                if (sessionState.current === "connecting") {
                  activeOpts.teardown();
                  wsState.current = transition(wsState.current, "CLOSED");
                  setInternalState("disconnected");
                  activeOpts.onStatusChange("idle");
                }
              }),
            },
          });
        } catch (connectErr: any) {
          const errMsg = String(connectErr?.message ?? connectErr ?? "");
          if (isModelRejection(undefined, undefined, errMsg)) {
            console.warn(`[AURA] Connection rejected: ${errMsg}. Trying next model in cascade...`);
            currentModelIndexRef.current++;
            isCascadingRef.current = true;
            wsState.current = transition(wsState.current, "CLOSED");
            setInternalState("disconnected");
            setTimeout(
              guardCallback(() => connect(activeOpts)),
              50,
            );
            return;
          }
          throw connectErr;
        }

        sessionRef.current = session;
        isSessionReadyRef.current = true;

        await onOpenPromise;

        const attemptsBeforeOpen = reconnectAttemptsRef.current;
        reconnectAttemptsRef.current = 0;
        setReconnectionAttempt(0);

        if (attemptsBeforeOpen > 0) {
          setIsRecovering(true);
          try {
            if (lastBehavioralLayerRef.current) {
              session.sendClientContent(lastBehavioralLayerRef.current);
            }
            const recentTurns = conversationTurnsRef.current.slice(-2);
            if (recentTurns.length > 0) {
              let contextText = recentTurns.map((t) => `${t.role}: ${t.text}`).join("\n");
              if (isAuraSpeakingRef.current) {
                contextText +=
                  "\n[System: Connection was lost mid-utterance. Please resume your thought.]";
                activeOpts.messageCallbacks.onInterrupted();
              }
              if (isUserSpeakingRef.current) {
                contextText +=
                  "\n[System: User audio was buffered but interrupted. User was speaking.]";
              }
              session.sendClientContent({
                turns: [{ role: "user", parts: [{ text: contextText }] }],
              });
            }
          } catch (e) {
            console.warn("[AURA] Recovery context send failed", e);
          }
          setIsRecovering(false);
        }

        activeOpts.onOpen(session, audioContext, stream);
      } catch (err: any) {
        clearTimeout(connectTimeoutId);
        setInternalState("failed");
        isCascadingRef.current = false;
        activeOpts.onStatusChange("error");
        const errMsg = err?.message || String(err);
        activeOpts.onError(errMsg);
        throw err;
      }
    },
    [setInternalState, guardCallback, shouldReconnect, nextDelay, reset],
  );

  useEffect(() => {
    connectRef.current = connect as any;
  }, [connect]);

  const updateConfig = useCallback(
    (voice: string) => {
      if (!sessionRef.current || sessionState.current !== "connected") return;
      console.log("[AURA] Voice change requires reconnection.");
      disconnect();
    },
    [disconnect],
  );

  useEffect(() => {
    const id = setInterval(() => {
      const ws = sessionRef.current;
      if (ws && sessionState.current === "connected") {
        try {
          ws.send({ realtimeInput: { mediaChunks: [] } });
        } catch {}
      }
    }, 25000);

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {};
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return {
    sessionRef,
    sessionState,
    isSessionReadyRef,
    perfRef,
    firstTokenEmitted,
    userApiKeyRef,
    connectionState,
    reconnectionAttempt,
    isRecovering,
    connect,
    disconnect,
    sendClientContent,
    sendRealtimeInput,
    updateConfig,
  };
}
