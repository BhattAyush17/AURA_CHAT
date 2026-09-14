import { ConversationStateManager } from "./ConversationStateManager";
import { RuntimeManager } from "./RuntimeManager";
import { auraTelemetry } from "@/telemetry/RuntimeTelemetry";
import { ENDPOINTS } from "@/config/api";

const PROACTIVE_INTERVAL_MS = 15_000;

export class ProactiveEngine {
  private static instance: ProactiveEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isCalling = false; // re-entrance guard
  private greetingFired = false;
  private sessionId: string | null = null;
  private userId: string | null = null;

  private constructor() {}

  public static getInstance(): ProactiveEngine {
    if (!ProactiveEngine.instance) {
      ProactiveEngine.instance = new ProactiveEngine();
    }
    return ProactiveEngine.instance;
  }

  private async triggerProactiveCall(isGreeting: boolean = false): Promise<void> {
    if (!this.sessionId || !this.userId) return;

    // Re-entrance guard: if a call is already in flight, skip this tick.
    if (this.isCalling) return;
    this.isCalling = true;

    try {
      const encodedSession = encodeURIComponent(this.sessionId);
      const encodedUser = encodeURIComponent(this.userId);
      const url = `${ENDPOINTS.proactive}/${encodedSession}?user_id=${encodedUser}${isGreeting ? "&greeting=true" : ""}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const data = await res.json();

      if (data.action && data.inject_text) {
        // Re-check IDLE state *after* the async fetch. The user may have
        // started speaking while we were waiting for the backend.
        const currentState = ConversationStateManager.getInstance().getState();
        if (currentState !== "IDLE" && !isGreeting) {
          console.log(
            `[ProactiveEngine] Discarding proactive intent — state is ${currentState}, not IDLE.`,
          );
          return;
        }

        console.log(`[ProactiveEngine] Triggering proactive intent: ${data.action}`);

        // Transition to THINKING to lock the state machine.
        ConversationStateManager.getInstance().advanceTo("THINKING", "Proactive trigger");

        // Inject proactive intent into RuntimeManager.
        await RuntimeManager.getInstance().processCognitiveTurn(
          data.inject_text,
          null,
          "adaptive",
          null,
          { wasInterruption: false },
        );
      }
    } catch (e) {
      // Rule 4: No silent fallbacks — emit telemetry for trapped errors.
      console.warn("[ProactiveEngine] Polling failure:", e);
      auraTelemetry.recordError({
        code: "proactive_engine_failure",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.isCalling = false;
    }
  }

  /**
   * Fires the initial greeting. Guarded against double-fire.
   * No-ops if `start()` has not been called.
   */
  public initiateGreeting(): void {
    if (!this.isRunning) {
      console.warn("[ProactiveEngine] initiateGreeting called before start(). Ignoring.");
      return;
    }
    if (this.greetingFired) {
      console.warn("[ProactiveEngine] Greeting already fired this session. Ignoring.");
      return;
    }
    this.greetingFired = true;
    console.log("[ProactiveEngine] Initiating greeting sequence...");
    this.triggerProactiveCall(true).catch(() => {
      // Already handled inside triggerProactiveCall; this catch prevents
      // unhandled rejection warnings on the fire-and-forget call.
    });
  }

  public start(sessionId: string, userId: string): void {
    this.sessionId = sessionId;
    this.userId = userId;
    if (this.isRunning) return;
    this.isRunning = true;
    this.greetingFired = false;

    this.timer = setInterval(() => {
      // Only act when strictly IDLE.
      if (ConversationStateManager.getInstance().getState() !== "IDLE") {
        return;
      }
      this.triggerProactiveCall(false);
    }, PROACTIVE_INTERVAL_MS);
  }

  public stop(): void {
    this.isRunning = false;
    this.isCalling = false;
    this.greetingFired = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
