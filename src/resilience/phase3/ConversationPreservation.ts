/**
 * ConversationPreservation — Persist and recover conversation state.
 *
 * Saves:
 *   - topic, emotion, momentum
 *   - last user intent / last assistant intent
 *   - turn count
 *
 * Recovery triggers:
 *   - tab reload (beforeunload + sessionStorage)
 *   - disconnect (provider failure recovery)
 *   - provider failure (mesh failover)
 *
 * Storage: sessionStorage (survives refresh, cleared on tab close)
 *
 * @module resilience/phase3/ConversationPreservation
 */

import type { ConversationSnapshot, ResilienceEvent } from "../types";

const STORAGE_KEY = "aura_conversation_snapshot";
const AUTO_SAVE_INTERVAL_MS = 5000;

export class ConversationPreservation {
  private snapshot: ConversationSnapshot;
  private saveHandle: ReturnType<typeof setInterval> | null = null;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;
  private isDirty = false;
  private beforeUnloadHandler: (() => void) | null = null;

  constructor(sessionId: string) {
    this.snapshot = {
      topic: "",
      emotion: "neutral",
      momentum: 0.5,
      lastUserIntent: "",
      lastAssistantIntent: "",
      turnCount: 0,
      savedAt: new Date().toISOString(),
      sessionId,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  start(eventSink?: (e: ResilienceEvent) => void): void {
    this.eventSink = eventSink ?? null;

    // Try to restore from previous session
    this.tryRestore();

    // Auto-save on interval
    this.saveHandle = setInterval(() => {
      if (this.isDirty) this.save();
    }, AUTO_SAVE_INTERVAL_MS);

    // Save on tab close/refresh
    if (typeof window !== "undefined") {
      this.beforeUnloadHandler = () => this.save();
      window.addEventListener("beforeunload", this.beforeUnloadHandler);
    }
  }

  stop(): void {
    if (this.saveHandle) {
      clearInterval(this.saveHandle);
      this.saveHandle = null;
    }
    if (typeof window !== "undefined" && this.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
    }
    // Final save
    this.save();
  }

  destroy(): void {
    this.stop();
  }

  // ── State Updates ─────────────────────────────────────────────

  updateTopic(topic: string): void {
    this.snapshot.topic = topic;
    this.isDirty = true;
  }

  updateEmotion(emotion: string): void {
    this.snapshot.emotion = emotion;
    this.isDirty = true;
  }

  updateMomentum(momentum: number): void {
    this.snapshot.momentum = Math.max(0, Math.min(1, momentum));
    this.isDirty = true;
  }

  updateUserIntent(intent: string): void {
    this.snapshot.lastUserIntent = intent;
    this.isDirty = true;
  }

  updateAssistantIntent(intent: string): void {
    this.snapshot.lastAssistantIntent = intent;
    this.isDirty = true;
  }

  incrementTurn(): void {
    this.snapshot.turnCount++;
    this.isDirty = true;
  }

  // ── State Access ──────────────────────────────────────────────

  getSnapshot(): Readonly<ConversationSnapshot> {
    return { ...this.snapshot };
  }

  /**
   * Build a recovery context string for injection into LLM prompts
   * after a disconnect/reload.
   */
  buildRecoveryContext(): string {
    if (!this.snapshot.topic && !this.snapshot.lastUserIntent) {
      return "";
    }

    const parts: string[] = [
      "[CONVERSATION RECOVERY CONTEXT — Session was interrupted]",
    ];

    if (this.snapshot.topic) {
      parts.push(`Previous topic: ${this.snapshot.topic}`);
    }
    if (this.snapshot.emotion !== "neutral") {
      parts.push(`Emotional state: ${this.snapshot.emotion}`);
    }
    if (this.snapshot.lastUserIntent) {
      parts.push(`Last user said: "${this.snapshot.lastUserIntent}"`);
    }
    if (this.snapshot.lastAssistantIntent) {
      parts.push(`Last AURA said: "${this.snapshot.lastAssistantIntent}"`);
    }
    parts.push(`Turn count: ${this.snapshot.turnCount}`);
    parts.push(
      "Resume naturally. Do not mention the interruption unless the user does."
    );
    parts.push("[/CONVERSATION RECOVERY CONTEXT]");

    return parts.join("\n");
  }

  // ── Internal ──────────────────────────────────────────────────

  private save(): void {
    this.snapshot.savedAt = new Date().toISOString();
    this.isDirty = false;

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot));
      this.emit({ kind: "conversation_saved", ts: performance.now() });
    } catch {
      // sessionStorage full or unavailable — silent fail
    }
  }

  private tryRestore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const stored: ConversationSnapshot = JSON.parse(raw);

      // Only restore if it's the same session or recent enough (<30min)
      const savedAt = new Date(stored.savedAt).getTime();
      const age = Date.now() - savedAt;
      const MAX_AGE = 30 * 60 * 1000; // 30 minutes

      if (stored.sessionId === this.snapshot.sessionId || age < MAX_AGE) {
        this.snapshot = { ...stored, sessionId: this.snapshot.sessionId };
        console.log(
          `[ConversationPreservation] Restored conversation state (topic: "${stored.topic}", turns: ${stored.turnCount})`
        );
        this.emit({ kind: "conversation_restored", ts: performance.now() });
      }
    } catch {
      // Corrupted or unavailable — start fresh
    }
  }

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
