import { ConversationStateManager } from "./ConversationStateManager";
import { RuntimeManager } from "./RuntimeManager";
import { auraTelemetry } from "@/telemetry/RuntimeTelemetry";
import { ENDPOINTS } from "@/config/api";
import { IntentionStore, type Intention } from "./autonomousConversation/IntentionStore";
import { getAutonomousConversationEngine } from "./autonomousConversation/AutonomousConversationEngine";
import { subscribeAutonomyUserActivity } from "./autonomousConversation/AutonomyEvents";
import type { IVoicePipeline } from "@/core/IVoicePipeline";
import type { AutonomousConversationDecision } from "./autonomousConversation/types";

/** Single initiative owner. Ticks do housekeeping; only admitted intentions generate speech. */
export class ProactiveEngine {
  private static instance: ProactiveEngine;
  static getInstance(): ProactiveEngine {
    return (this.instance ??= new ProactiveEngine());
  }
  private store = new IntentionStore();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void)[] = [];
  private epoch = 0;
  private fetchController: AbortController | null = null;
  private lastPoll = 0;
  private lastActivity = Date.now();
  private lastAttempt = 0;
  private attempts: number[] = [];
  private active: {
    intention: Intention;
    decision: AutonomousConversationDecision;
    started: number;
    spoke: boolean;
  } | null = null;
  private getPipeline: (() => IVoicePipeline) | null = null;
  private userId = "";
  private mode: "off" | "shadow" | "enabled" = "enabled";
  private traces: { at: number; id: string; outcome: string; reason: string }[] = [];

  public configure(mode: "off" | "shadow" | "enabled"): void {
    this.mode = mode;
    if (mode !== "enabled") this.cancelActive("initiative_disabled");
  }
  public diagnostics() {
    return { mode: this.mode, intentions: this.store.snapshot(), traces: [...this.traces] };
  }
  private trace(id: string, outcome: string, reason: string) {
    this.traces.push({ at: Date.now(), id, outcome, reason });
    if (this.traces.length > 100) this.traces.shift();
    RuntimeManager.getInstance().observe({
      subsystem: "Autonomy",
      severity: "info",
      data: { id, outcome, reason },
    });
  }
  public start(userId: string, getPipeline: () => IVoicePipeline): void {
    this.stop();
    this.userId = userId;
    this.getPipeline = getPipeline;
    this.lastActivity = Date.now();
    this.lastPoll = 0;
    this.lastAttempt = 0;
    this.attempts = [];
    this.unsubscribe = [
      RuntimeManager.getInstance().subscribeAutonomy(() => {
        this.cancelActive("new_user_turn");
        this.lastActivity = Date.now();
        this.proposeFromSnapshot();
      }),
      subscribeAutonomyUserActivity(() => {
        this.lastActivity = Date.now();
        this.cancelActive("user_speech");
      }),
      ConversationStateManager.getInstance().subscribe((state) => {
        if (state === "USER_SPEAKING") {
          this.lastActivity = Date.now();
          this.cancelActive("user_speech");
        }
      }),
    ];
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }
  private proposeFromSnapshot() {
    const snapshot = RuntimeManager.getInstance().getAutonomySnapshot();
    const input = snapshot.input;
    if (
      !input ||
      !input.social.conversational_momentum.exploratory ||
      input.social.should_continue_listening
    )
      return;
    const now = Date.now();
    this.store.enqueue({
      id: `executive-${snapshot.revision}`,
      dedupeKey: `executive-${snapshot.revision}`,
      source: "executive",
      revision: snapshot.revision,
      evidenceIds: [`turn-${snapshot.revision}`],
      description:
        "Offer one useful connection to the current topic, only if the last response has not already covered it.",
      createdAt: now,
      expiresAt: now + 90_000,
      earliestAttemptAt: now + 5000,
      priority: 0.5,
    });
  }
  private available(): boolean {
    const p = this.getPipeline?.();
    const state = ConversationStateManager.getInstance().getState();
    return Boolean(
      p &&
      p.getSessionId?.() &&
      p.deliverAutonomous &&
      p.status === "listening" &&
      !p.isThinking &&
      !p.isSpeaking &&
      (state === "IDLE" || state === "LISTENING") &&
      Date.now() - this.lastActivity >= 4000,
    );
  }
  private cancelActive(reason: string) {
    if (!this.active) return;
    const active = this.active;
    this.active = null;
    this.getPipeline?.().cancelAutonomous?.();
    this.store.finish(active.intention.id, "interrupted", reason);
    this.trace(active.intention.id, "interrupted", reason);
    getAutonomousConversationEngine().recordOutcome({
      actionTaken: active.decision.action,
      askedQuestion: active.decision.action === "ASK",
      userAnswered: false,
      userElaborated: false,
      userDisengaged: false,
      userInterrupted: reason === "user_speech",
      initiativeWasUseful: false,
      timestamp: Date.now(),
    });
  }
  private async poll() {
    const sessionId = this.getPipeline?.().getSessionId?.();
    if (!sessionId || this.fetchController) return;
    const epoch = this.epoch;
    const revision = RuntimeManager.getInstance().getAutonomySnapshot().revision;
    const controller = new AbortController();
    this.fetchController = controller;
    this.lastPoll = Date.now();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `${ENDPOINTS.proactive}/${encodeURIComponent(sessionId)}?user_id=${encodeURIComponent(this.userId)}`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`proactive HTTP ${res.status}`);
      const data = await res.json();
      if (
        epoch !== this.epoch ||
        revision !== RuntimeManager.getInstance().getAutonomySnapshot().revision
      )
        return;
      if (
        typeof data.action !== "string" ||
        typeof data.inject_text !== "string" ||
        !data.inject_text.trim()
      )
        return;
      const now = Date.now();
      this.store.enqueue({
        id: crypto.randomUUID(),
        dedupeKey: `${revision}:${data.action}`,
        source: "proactive",
        revision,
        evidenceIds: [`turn-${revision}`, `proactive:${data.action}`],
        description: data.inject_text.slice(0, 2000),
        createdAt: now,
        expiresAt: now + 60_000,
        earliestAttemptAt: now,
        priority: 0.7,
      });
    } catch (error) {
      if (!controller.signal.aborted)
        auraTelemetry.recordError({ code: "proactive_engine_failure", message: String(error) });
    } finally {
      clearTimeout(timeout);
      if (this.fetchController === controller) this.fetchController = null;
    }
  }
  public async tick(): Promise<void> {
    if (!this.getPipeline || this.mode === "off") return;
    const now = Date.now();
    this.store.expire(now);
    const pipeline = this.getPipeline();
    if (["idle", "error", "disconnecting"].includes(pipeline.status)) {
      this.stop();
      return;
    }
    if (this.active) {
      if (pipeline.isSpeaking) this.active.spoke = true;
      if (this.active.spoke && pipeline.status === "listening" && !pipeline.isSpeaking) {
        const id = this.active.intention.id;
        this.store.finish(id, "delivered", "playback_completed");
        this.trace(id, "delivered", "playback_completed_usefulness_unknown");
        this.active = null;
        this.lastActivity = now;
      } else if (now - this.active.started > 45_000)
        this.cancelActive("delivery_timeout_uncertain");
      return;
    }
    if (pipeline.isSpeaking || pipeline.isThinking) {
      this.lastActivity = now;
      return;
    }
    if (!this.available()) return;
    const snapshot = RuntimeManager.getInstance().getAutonomySnapshot();
    // Affect and unresolved intentions must not remain fresh indefinitely.
    if (!snapshot.input || now - snapshot.updatedAt > 120_000) return;
    this.attempts = this.attempts.filter((at) => now - at < 3600_000);
    const interrupted = getAutonomousConversationEngine()
      .getRecentOutcomes()
      .filter((o) => o.userInterrupted).length;
    if (now - this.lastAttempt < 120_000 + interrupted * 60_000 || this.attempts.length >= 6)
      return;
    if (now - this.lastPoll >= 30_000 && this.mode !== "shadow") void this.poll();
    const candidate = this.store.reserve(snapshot.revision, now);
    if (!candidate) return;
    const input = snapshot.input;
    const momentum = input.social.conversational_momentum;
    if (
      momentum.user_wants_space ||
      momentum.user_elaborating ||
      momentum.unfinished_thought ||
      input.literal === "goodbye" ||
      input.speakerGoal === "close" ||
      input.speakerGoal === "drop-thread"
    ) {
      this.store.finish(candidate.id, "cancelled", "user_holds_floor_or_closed");
      this.trace(candidate.id, "DROP", "user_holds_floor_or_closed");
      return;
    }
    const decision = getAutonomousConversationEngine().evaluate({
      ...input,
      backgroundEvaluation: true,
      auraJustSpoke: now - this.lastActivity < 1500,
      timing: { ...input.timing, silenceDurationMs: now - this.lastActivity },
    });
    if (
      !decision.shouldSpeak ||
      decision.action === "WAIT" ||
      decision.action === "RESPOND_ONLY" ||
      decision.permission !== "allowed" ||
      decision.confidence < 0.6
    ) {
      this.store.defer(candidate.id, now + 15_000, decision.reason ?? "insufficient_evidence");
      this.trace(candidate.id, "DEFER", decision.reason ?? "insufficient_evidence");
      return;
    }
    if (this.mode === "shadow") {
      this.store.finish(candidate.id, "cancelled", "shadow_would_speak");
      this.trace(candidate.id, "SPEAK_SHADOW", decision.reason ?? "eligible");
      return;
    }
    if (
      !this.available() ||
      RuntimeManager.getInstance().getAutonomySnapshot().revision !== candidate.revision
    ) {
      this.store.defer(candidate.id, now + 5000, "situation_changed");
      return;
    }
    this.lastAttempt = now;
    this.attempts.push(now);
    const active = { intention: candidate, decision, started: now, spoke: false };
    this.active = active;
    this.store.finish(candidate.id, "submitted", "provider_dispatch");
    this.trace(candidate.id, "SPEAK", decision.reason ?? "eligible");
    try {
      const accepted = await pipeline.deliverAutonomous!(
        RuntimeManager.getInstance().buildAutonomousPrompt(
          `${candidate.description}\n${decision.responseGuidance ?? ""}`,
        ),
      );
      if (!accepted && this.active === active) {
        this.store.finish(candidate.id, "failed", "provider_rejected");
        this.trace(candidate.id, "failed", "provider_rejected");
        this.active = null;
      }
    } catch (error) {
      if (this.active === active) {
        this.cancelActive("provider_failure");
        auraTelemetry.recordError({ code: "autonomy_delivery_failure", message: String(error) });
      }
    }
  }
  public stop(): void {
    this.epoch++;
    this.cancelActive("session_ended");
    this.fetchController?.abort();
    this.fetchController = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe = [];
    this.getPipeline = null;
    this.store.clear();
  }
}
