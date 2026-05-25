/**
 * useGeminiLive — Composition wrapper for the AURA voice companion.
 *
 * This is a THIN ORCHESTRATION LAYER that composes focused sub-hooks:
 *   - useGeminiWebSocket: WebSocket lifecycle + message routing
 *   - useAudioPipeline: Mic capture, playback, VAD, volume
 *   - useBehaviorInjection: /api/analyze + speculative pre-fetch
 *   - useTranscriptManager: Conversation history
 *   - usePromptOrchestrator: L1/L2/L3 prompting + hysteresis
 *   - useInterruptionHandler: Barge-in detection
 *   - useResponseTiming: Adaptive micro-delays
 *
 * The return type is IDENTICAL to the pre-refactor version.
 * No consumer of useGeminiLive() needs to change.
 *
 * @module
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useInterruptionHandler } from "@/shared/useInterruption";
import { useResponseTiming } from "@/shared/useResponseTiming";
import { emitLatency } from "@/components/LatencyMeter";
import { isLateNightHour } from "@/lib/gemini-prompt";
import { getGeminiKey } from "@/lib/api";
import { getStorageManager } from "@/lib/storage/manager";
import { generateSeed } from "@/lib/utils/seed-generator";
import { ENDPOINTS } from "@/config/api";
import {
  clearAllCredentials,
  hasRequiredCredentials,
  hasSupabaseCredentials,
} from "@/lib/credentials";
import {
  shouldShowSetupPrompt,
  incrementConversationCount,
  getConversationCount,
} from "@/lib/usage-tracker";
import { saveSyncMeta } from "@/lib/sync-meta";
import { resolveUserId } from "@/lib/user-identity";
import { getCredential } from "@/lib/credentials";
import { ContextBudgetManager } from "@/lib/context-budget";

import { useGeminiWebSocket } from "./useWebSocket";
import { useAudioPipeline } from "./useAudioPipeline";
import { useBehaviorInjection } from "./useBehaviorInjection";
import { useTranscriptManager } from "./useTranscript";
import { usePromptOrchestrator } from "./usePromptOrchestrator";
import {
  claimPrimaryTab,
  isPrimaryTab,
  initSessionId,
  HEARTBEAT_KEY,
  HEARTBEAT_INTERVAL,
  createPerfTimings,
} from "./types";
import type { AuraAnalysis, UIStatus } from "./types";

// Re-export for backward compatibility
export type { AuraAnalysis } from "./types";
export type SessionState = "idle" | "connecting" | "connected" | "disconnecting" | "error";

const sessionEndInProgress = new Set<string>();

/* ------------------------------------------------------------------ */
/*  The Composition Hook                                               */
/* ------------------------------------------------------------------ */

export function useGeminiLive(mode: string = "adaptive", voice: string = "Zephyr") {
  const isInactive = mode === "__inactive__";
  const storageManager = getStorageManager();

  const deviceId = useMemo(() => {
    let id = localStorage.getItem("aura_device_id");
    if (!id) {
      id = `device_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem("aura_device_id", id);
    }
    return id;
  }, []);

  // ── UI State ────────────────────────────────────────────────────
  const [status, setStatus] = useState<UIStatus>("idle");
  const [isThinking, setIsThinking] = useState(false);
  const [auraState, setAuraState] = useState<AuraAnalysis | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sessionStartTime] = useState<number>(() => Date.now());
  const [warning, setWarning] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCloudSyncPrompt, setShowCloudSyncPrompt] = useState(false);
  const isStartingRef = useRef(false);
  const backendAvailable = useRef(true);

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  // ── Memories ────────────────────────────────────────────────────
  const [memories, setMemories] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("aura_memories") || "[]");
    } catch {
      return [];
    }
  });
  const addMemory = useCallback((fact: string) => {
    setMemories((prev) => {
      const updated = [...prev, fact].slice(-12);
      localStorage.setItem("aura_memories", JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── User/Session identity ───────────────────────────────────────
  const sessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string>("local-user");

  // ── Timing refs ─────────────────────────────────────────────────
  const roundTripStartRef = useRef<number>(0);
  const pauseSinceLastTurnRef = useRef<number>(0);
  const lastTurnEndTimeRef = useRef<number>(performance.now());
  const isFirstChunkOfTurnRef = useRef<boolean>(true);
  const responseDelayAppliedRef = useRef<boolean>(false);
  const lastChunkTime = useRef<number | null>(null);
  const sessionTurnCountRef = useRef<number>(0);
  const currentResponseTextRef = useRef<string>("");
  const [voiceLanguage] = useState<string>("hi-IN");
  const voiceLanguageRef = useRef<string>("hi-IN");

  // ── Timers ──────────────────────────────────────────────────────
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sub-hooks ───────────────────────────────────────────────────
  const transcript_ = useTranscriptManager();
  const prompts = usePromptOrchestrator();
  const behavior = useBehaviorInjection();
  const ws = useGeminiWebSocket();
  const audio = useAudioPipeline(() => {
    /* onInterrupt placeholder */
  });
  const { getResponseDelay, recordTurn: recordTimingTurn } = useResponseTiming();
  const budgetManager = useMemo(() => new ContextBudgetManager(), []);

  // Barge-in detection
  const bargeIn = useInterruptionHandler({
    audioContextRef: audio.audioContextRef,
    micStreamRef: audio.streamRef,
    isSpeaking: audio.isSpeaking,
    currentResponseTextRef: currentResponseTextRef,
    onDuck: audio.interruptPlayback,
    onFlush: audio.flushAudioQueue,
  });

  // ── Daily usage tracking ────────────────────────────────────────
  const getDailyUsageMinutes = useCallback((userId: string): number => {
    const key = `aura_daily_usage_${userId}_${new Date().toDateString()}`;
    return parseInt(localStorage.getItem(key) ?? "0", 10);
  }, []);
  const addDailyUsage = useCallback(
    (userId: string, minutes: number) => {
      const key = `aura_daily_usage_${userId}_${new Date().toDateString()}`;
      localStorage.setItem(key, String(getDailyUsageMinutes(userId) + minutes));
    },
    [getDailyUsageMinutes],
  );

  // ── Session end persistence ─────────────────────────────────────
  const handleSessionEnd = useCallback(async () => {
    if (!sessionIdRef.current || sessionEndInProgress.has(sessionIdRef.current)) return;
    sessionEndInProgress.add(sessionIdRef.current);
    const t = transcript_.transcriptRef.current;
    try {
      if (!t || t.length < 3) return;
      const sessionData = {
        session_id: sessionIdRef.current,
        transcript: t,
        user_id: userIdRef.current,
        last_active: new Date().toISOString(),
      };
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
      saveSyncMeta(userIdRef.current, {
        updatedAt: newSeed.updatedAt,
        hasCloudCopy: hasSupabaseCredentials(),
      });
      incrementConversationCount(userIdRef.current);
      clearAllCredentials();
      localStorage.removeItem("aura_session_v1");
      sessionStorage.removeItem("aura_transcript_backup");
      addDailyUsage(userIdRef.current, Math.ceil((Date.now() - sessionStartTime) / 60000));
      try {
        localStorage.setItem("aura_last_session_end", String(Date.now()));
      } catch {}
      if (shouldShowSetupPrompt(userIdRef.current)) setShowCloudSyncPrompt(true);
    } catch (err) {
      console.error("[AURA] Session end failed:", err);
    } finally {
      [inactivityTimer, silenceTimerRef, hardCapTimerRef].forEach((r) => {
        if (r.current) clearTimeout(r.current);
        r.current = null;
      });
      if (sessionIdRef.current) sessionEndInProgress.delete(sessionIdRef.current);
    }
  }, [storageManager, sessionStartTime, addDailyUsage]);

  // ── Teardown (unified) ──────────────────────────────────────────
  const teardownResources = useCallback(() => {
    if (ws.sessionRef.current) {
      try {
        ws.sessionRef.current.close?.();
      } catch {}
      ws.sessionRef.current = null;
    }
    audio.teardown();
    sessionTurnCountRef.current = 0;
    transcript_.sessionHighlightsRef.current = [];
    transcript_.turnCountRef.current = 0;
  }, [audio, ws, transcript_]);

  // ── Silence timer ───────────────────────────────────────────────
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
  }, [handleSessionEnd, teardownResources]);

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    resetSilenceTimer();
  }, [resetSilenceTimer]);
  useEffect(() => {
    if (transcript_.transcript.length > 0) recordActivity();
  }, [transcript_.transcript, recordActivity]);

  // ── Tab heartbeat ───────────────────────────────────────────────
  useEffect(() => {
    const myTabId = claimPrimaryTab();
    const interval = setInterval(() => {
      const raw = localStorage.getItem(HEARTBEAT_KEY);
      try {
        const current = raw ? JSON.parse(raw) : null;
        if (
          !current ||
          current.tabId === myTabId ||
          Date.now() - current.ts > HEARTBEAT_INTERVAL * 2
        )
          localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ tabId: myTabId, ts: Date.now() }));
      } catch {
        claimPrimaryTab();
      }
    }, HEARTBEAT_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // ── Beforeunload ────────────────────────────────────────────────
  useEffect(() => {
    function handleUnload() {
      if (transcript_.transcriptRef.current?.length >= 3 && isPrimaryTab()) {
        localStorage.setItem(
          `aura_seed_${userIdRef.current}`,
          JSON.stringify(generateSeed(transcript_.transcriptRef.current)),
        );
        localStorage.setItem(
          `aura_conversation_count_${userIdRef.current}`,
          String(getConversationCount(userIdRef.current) + 1),
        );
        sessionStorage.setItem("aura_pending_session", "true");
      }
    }
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // ── User Turn Handler (addTurn + behavior + L2 + atomic send) ──
  const handleUserTurn = useCallback(
    (text: string) => {
      transcript_.addTurn(text, true);

      if (!sessionIdRef.current) return;

      const emotionForThisTurn = prompts.lastEmotionRef.current;
      const layer2ForThisTurn = prompts.layer2Ref.current;
      const emotionChanged = prompts.emotionChangedRef.current;

      // Behavior analysis (with speculative short-circuit)
      const wasInterrupted = bargeIn.consumeInterrupted();
      behavior
        .analyzeForTurn(
          text,
          sessionIdRef.current,
          audio.currentRmsRef.current,
          pauseSinceLastTurnRef.current,
          modeRef.current,
          userIdRef.current,
          wasInterrupted,
        )
        .then((result) => {
          if (result) {
            behavior.applyBehavioralInjection(result, ws.sessionRef.current, text, modeRef.current);
            prompts.processAnalysisForL2(result);
          }
        })
        .catch((err) => console.warn("[AURA] Background analysis failed:", err));

      // Atomic turn send (100ms delay for behavioral injection to settle)
      const turnDelay = 100;
      setTimeout(() => {
        if (ws.sessionRef.current) {
          ws.perfRef.current.t3 = performance.now();
          const currentMode = (emotionForThisTurn as any)?.mode || "engaged";
          const ctx = prompts.buildContext(currentMode);

          const allTurns = transcript_.transcriptRef.current.map((t) => ({
            role: t.user_initiated ? "user" : "assistant",
            text: t.text,
            timestamp: Date.now(),
          }));

          const truncated = budgetManager.truncateHistory(allTurns as any);
          const payloadTurns = truncated.map((t) => ({
            role: t.role === "assistant" ? "model" : "user",
            parts: [{ text: t.text }],
          }));

          if (payloadTurns.length > 0) {
            payloadTurns[payloadTurns.length - 1].parts[0].text = ctx + text;
          }

          ws.sendClientContent({
            turns: payloadTurns,
            turnComplete: true,
            ...(emotionChanged && { systemInstruction: { parts: [{ text: layer2ForThisTurn }] } }),
          });

          if (emotionChanged) {
            prompts.confirmL2Sent(emotionForThisTurn);
          }
          console.log("[AURA] ⚡ Atomic Layered Turn Sent");
        }
      }, turnDelay);

      transcript_.turnCountRef.current += 1;

      // Thread reference every 5 turns
      if (
        transcript_.turnCountRef.current % 5 === 0 &&
        transcript_.sessionHighlightsRef.current.length > 1 &&
        ws.sessionRef.current &&
        ws.isSessionReadyRef.current
      ) {
        const refStr = transcript_.sessionHighlightsRef.current[0];
        ws.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `[THREAD] Earlier: "${refStr}" — use naturally if it connects. Don't force it. [/THREAD]`,
                },
              ],
            },
          ],
          turnComplete: false,
        });
      }
    },
    [transcript_, prompts, behavior, ws, audio, bargeIn],
  );

  // ── End session ─────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    ws.sessionState.current = "disconnecting";
    await handleSessionEnd();
    ws.disconnect();
    bargeIn.reset();
    currentResponseTextRef.current = "";
    behavior.resetSpeculative();
    teardownResources();
    setStatus("idle");
    ws.sessionState.current = "idle";
    audio.setIsSpeakingState(false);
    audio.setIsActiveVoice(false);
    setIsThinking(false);
    isStartingRef.current = false;
  }, [teardownResources, handleSessionEnd, ws, bargeIn, behavior, audio]);

  // Deactivation effect
  useEffect(() => {
    if (isInactive && status !== "idle") {
      console.log("[Gemini Live] Hook is inactive, triggering teardown...");
      void endSession();
    }
  }, [isInactive, status, endSession]);

  // ── Start session ───────────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (ws.sessionState.current !== "idle" && ws.sessionState.current !== "error") return;
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    console.log("[AURA] 🎙️ Starting session request...");
    const userId = await resolveUserId(getCredential("supabase_user_email") || undefined);
    console.log("[AURA] Resolved Identity:", userId);
    userIdRef.current = userId;
    storageManager.setUserId(userId);

    if (shouldShowSetupPrompt(userId)) {
      setShowCloudSyncPrompt(true);
    }
    if (!hasRequiredCredentials()) {
      setShowSettingsModal(true);
      isStartingRef.current = false;
      return;
    }

    setStatus("connecting");
    setLastError(null);

    if (isLateNightHour() && modeRef.current === "adaptive") {
      modeRef.current = "latenight";
      console.log("[AURA] 🌙 Late-night mode auto-activated");
    }

    try {
      const seedData = await storageManager.loadSeed();
      const seedBlock = seedData ? seedData.seed : undefined;

      await ws.connect({
        voice: voiceRef.current,
        voiceLanguage: voiceLanguageRef.current,
        personality: modeRef.current,
        seedBlock,
        setupAudio: async (stream) => {
          return audio.setupAudioGraph(
            stream,
            ws.sessionRef,
            ws.sessionState as any,
            ws.isSessionReadyRef,
            ws.perfRef,
            isFirstChunkOfTurnRef,
            pauseSinceLastTurnRef,
            lastTurnEndTimeRef,
            lastChunkTime,
          );
        },
        onOpen: (session, audioContext, stream) => {
          // Wire mic to session immediately
          // (Handled internally by useAudioPipeline using the worklet output)

          // Send greeting after 250ms
          setTimeout(() => {
            if (ws.sessionState.current !== "connected") return;
            if (transcript_.transcriptRef.current.length === 0 && ws.sessionRef.current) {
              try {
                ws.sendClientContent({
                  turns: [
                    { role: "user", parts: [{ text: prompts.getGreeting(modeRef.current) }] },
                  ],
                  turnComplete: true,
                });
                setIsThinking(true);
                console.log("[AURA] 🎤 Greeting sent.");
              } catch (e) {
                console.warn("[AURA] Failed to send greeting:", e);
              }
            }
          }, 250);

          if (audioContext.state !== "closed") void audioContext.resume();
          audio.startVolumeLoop();
        },
        messageCallbacks: {
          onServerContent: () => {
            setIsThinking(false);
          },
          onAudio: (base64Data) => {
            ws.perfRef.current.t4 = performance.now();
            const genStart =
              ws.perfRef.current.t3 > 0 ? ws.perfRef.current.t4 - ws.perfRef.current.t3 : 0;
            ws.perfRef.current.geminiGenStart = genStart;
            setIsThinking(false);
            audio.setIsSpeakingState(true);
            emitLatency({
              roundTrip: performance.now() - roundTripStartRef.current,
              geminiGenStart: genStart,
            });

            // Adaptive delay: offset FIRST chunk only
            let delayOffset = 0;
            if (!responseDelayAppliedRef.current) {
              const sensing = behavior.lastAnalysisRef.current?.sensing_state;
              delayOffset = getResponseDelay({
                emotionalState: {
                  mode: sensing?.mode || "engaged",
                  tension: sensing?.tension || 0,
                  energy: sensing?.energy || 0.5,
                },
                wasInterrupted: bargeIn.stateRef.current.wasInterrupted,
                turnIndex: sessionTurnCountRef.current,
              });
              responseDelayAppliedRef.current = true;
              if (delayOffset > 0) console.log(`[AURA] ⏱ Response delay: ${delayOffset}ms`);
            }

            audio.schedulePlayback(
              base64Data,
              audio.audioContextRef.current!,
              audio.outputAnalyserRef.current!,
              delayOffset / 1000,
            );
            ws.perfRef.current.t5 = performance.now();
          },
          onModelText: (text) => {
            transcript_.addTurn(text, false);
            currentResponseTextRef.current += text;
          },
          onInputTranscription: (partialText) => {
            console.log(
              "%c🗣️ USER SAID (Gemini Live): " + partialText,
              "color: #3b82f6; font-weight: bold; font-size: 13px;",
            );
            handleUserTurn(partialText);
            if (sessionIdRef.current) {
              behavior.fireSpeculative(partialText, sessionIdRef.current, userIdRef.current);
            }
          },
          onToolCall: (functionCalls) => {
            return functionCalls.map((fc: any) => {
              if (fc.name === "saveMemory") {
                addMemory(fc.args.fact);
                return { id: fc.id, name: fc.name, response: { result: "Saved" } };
              }
              if (fc.name === "updateAnalysis") {
                setAuraState({
                  words: fc.args.user_words,
                  tone: fc.args.detected_tone,
                  intent: fc.args.perceived_intent,
                });
                return { id: fc.id, name: fc.name, response: { result: "Logged" } };
              }
              return { id: fc.id, name: fc.name, response: { error: "Unknown" } };
            });
          },
          onTurnComplete: () => {
            ws.perfRef.current.t2 = performance.now();
            lastTurnEndTimeRef.current = performance.now();
            isFirstChunkOfTurnRef.current = true;
            responseDelayAppliedRef.current = false;
            currentResponseTextRef.current = "";
            recordTimingTurn();
          },
          onInterrupted: () => {
            audio.interruptPlayback(0);
            ws.isSessionReadyRef.current = false;
            setTimeout(() => {
              ws.isSessionReadyRef.current = true;
              if (ws.sessionRef.current && ws.sessionState.current === "connected") {
                try {
                  ws.sendClientContent({
                    turns: [
                      {
                        role: "user",
                        parts: [
                          {
                            text: "[INTERRUPTION: The user cut you off. This is natural — don't apologize or acknowledge being interrupted. Simply listen for what they want to say. If they stay silent, gently continue from where you were or pivot to what matters now. Never say 'sorry I was interrupted' or 'as I was saying'.]",
                          },
                        ],
                      },
                    ],
                    turnComplete: false,
                  });
                } catch (e) {
                  console.warn("[AURA] Interruption recovery failed:", e);
                }
              }
            }, 200);
            ws.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "[INTERRUPTED] You were cut off. Don't acknowledge it. Don't apologize. Just listen to what comes next and respond to that.",
                    },
                  ],
                },
              ],
              turnComplete: false,
            });
          },
          onUsageMetadata: (meta) => {
            ws.perfRef.current.turnTokens = meta.totalTokenCount ?? 0;
            const elapsed = (performance.now() - ws.perfRef.current.t3) / 1000;
            ws.perfRef.current.tokenThroughput =
              elapsed > 0 ? Math.round((meta.candidatesTokenCount ?? 0) / elapsed) : 0;
            emitLatency({
              turnTokens: ws.perfRef.current.turnTokens,
              tokenThroughput: ws.perfRef.current.tokenThroughput,
            });
          },
        },
        onStatusChange: (s) => setStatus(s),
        onError: (e) => setLastError(e),
        teardown: teardownResources,
      });

      prompts.seedRef.current.content = seedData?.seed || "";
      if (prompts.seedRef.current.content) emitLatency("memoryLayer", "seed");
      else emitLatency("memoryLayer", "live");

      await prompts.warmL2Cache();

      sessionIdRef.current = initSessionId();
      transcript_.reset();

      // Fire session registration async
      fetch(
        `${ENDPOINTS.sessionStart}?user_id=${userId}&seed=${encodeURIComponent(prompts.seedRef.current.content || "")}&device_id=${deviceId}`,
        { method: "POST", headers: { Authorization: `Bearer ${getGeminiKey()}` } },
      )
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          sessionIdRef.current = data.session_id;
          localStorage.setItem("aura_session_v1", data.session_id);
          if (data.canonical_seed && data.canonical_seed !== prompts.seedRef.current.content) {
            prompts.seedRef.current.content = data.canonical_seed;
            console.log("[AURA] Seed synced from Supabase");
          }
        })
        .catch(() => {
          backendAvailable.current = false;
        });
    } catch (err) {
      try {
        teardownResources();
      } catch {}
      ws.sessionState.current = "error";
      setStatus("error");
      setLastError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      isStartingRef.current = false;
    }
  }, [
    ws,
    audio,
    prompts,
    behavior,
    transcript_,
    teardownResources,
    handleSessionEnd,
    storageManager,
    deviceId,
    addMemory,
    handleUserTurn,
    getResponseDelay,
    bargeIn,
    recordTimingTurn,
  ]);

  const audioRef = useRef(audio);
  const wsRef = useRef(ws);
  const teardownRef = useRef(teardownResources);

  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  useEffect(() => {
    teardownRef.current = teardownResources;
  }, [teardownResources]);

  // ── Visibility change ───────────────────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      // FIX: Removed automatic audioContext suspend/resume on tab switch to prevent mic input fall.
      // This allows the microphone to stay active in the background.
      if (document.hidden) {
        console.log("[AURA] 👁️ Tab hidden. AudioContext remains running to preserve mic input.");
      } else {
        console.log("[AURA] 👁️ Tab visible.");
        const ctx = audioRef.current?.audioContextRef.current;
        if (ctx?.state === "suspended") {
          ctx.resume().catch((e) => console.warn("[AURA] Could not auto-resume audio:", e));
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // ── Proactive engagement polling ────────────────────────────────
  // Polls /api/proactive every 15s during idle periods. If a trigger
  // fires, injects the prompt and Gemini responds unprompted.
  useEffect(() => {
    if (status !== "listening" || !sessionIdRef.current) return;

    const interval = setInterval(async () => {
      // Only check if user hasn't spoken recently
      const silentMs = Date.now() - lastActivityRef.current;
      if (silentMs < 30000) return; // Active in last 30s — skip

      // Don't check if AURA is currently speaking
      if (audioRef.current.isSpeakingRef.current) return;

      try {
        const res = await fetch(
          `${ENDPOINTS.proactive}/${sessionIdRef.current}?user_id=${userIdRef.current}`,
        );
        if (!res.ok) return;
        const data = await res.json();

        const currentWs = wsRef.current;
        if (
          data.action &&
          data.inject_text &&
          currentWs.sessionRef.current &&
          currentWs.sessionState.current === "connected"
        ) {
          console.log(`[AURA] 🫧 Proactive trigger: ${data.action}`);
          currentWs.sendClientContent({
            turns: [{ role: "user", parts: [{ text: data.inject_text }] }],
            turnComplete: true,
          });
          setIsThinking(true);
        }
      } catch {} // Swallow — proactive is optional
    }, 15000);

    return () => clearInterval(interval);
  }, [status]);

  // ── Cleanup on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      teardownRef.current();
    };
  }, []);

  // ── EXACT SAME return type as original ──────────────────────────
  return {
    status,
    isSpeaking: audio.isSpeaking,
    isThinking,
    volume: audio.volume,
    isActiveVoice: audio.isActiveVoice,
    auraState,
    memories,
    lastError,
    warning,
    showSettingsModal,
    setShowSettingsModal,
    showCloudSyncPrompt,
    setShowCloudSyncPrompt,
    getInputFrequencyData: audio.getInputFrequencyData,
    getOutputFrequencyData: audio.getOutputFrequencyData,
    startSession,
    endSession,
    updateConfig: useCallback(
      (newVoice?: string, newMode?: string) => {
        if (newVoice) {
          voiceRef.current = newVoice;
          ws.updateConfig(newVoice);
        }
        if (newMode) {
          console.log(`[AURA] 🎭 Personality mode shift: ${newMode}`);
          modeRef.current = newMode;
          if (ws.sessionState.current === "connected") {
            endSession().then(() => setTimeout(() => startSession(), 300));
          }
        }
      },
      [ws, endSession, startSession],
    ),
    backendAvailable,
    updateVoice: useCallback(
      (newVoice: string) => {
        console.log(`[AURA] 🎭 Voice change requested: ${newVoice}`);
        voiceRef.current = newVoice;
        if (ws.sessionState.current === "connected") {
          endSession().then(() => setTimeout(() => startSession(), 300));
        }
      },
      [endSession, startSession, ws],
    ),
  };
}
