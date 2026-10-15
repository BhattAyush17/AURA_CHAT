export type IntentionStatus =
  | "pending"
  | "reserved"
  | "submitted"
  | "delivered"
  | "interrupted"
  | "expired"
  | "cancelled"
  | "failed";
export interface Intention {
  id: string;
  dedupeKey: string;
  source: "executive" | "proactive";
  description: string;
  revision: number;
  evidenceIds: string[];
  createdAt: number;
  expiresAt: number;
  earliestAttemptAt: number;
  priority: number;
  status: IntentionStatus;
  reason?: string;
}

/** Session-local intentions. Terminal entries remain as bounded dedupe tombstones. */
export class IntentionStore {
  private entries = new Map<string, Intention>();
  constructor(private readonly capacity = 32) {}

  enqueue(input: Omit<Intention, "status">, now = Date.now()): boolean {
    this.expire(now);
    if (
      input.expiresAt <= now ||
      [...this.entries.values()].some((e) => e.dedupeKey === input.dedupeKey)
    )
      return false;
    if (this.entries.size >= this.capacity) {
      const victim =
        [...this.entries.values()].find(
          (e) => !["pending", "reserved", "submitted"].includes(e.status),
        ) ??
        [...this.entries.values()]
          .filter((e) => e.status === "pending" && e.priority < input.priority)
          .sort((a, b) => a.priority - b.priority)[0];
      if (!victim) return false;
      this.entries.delete(victim.id);
    }
    this.entries.set(input.id, {
      ...input,
      evidenceIds: [...input.evidenceIds],
      status: "pending",
    });
    return true;
  }
  expire(now = Date.now()): void {
    for (const entry of this.entries.values()) {
      if (entry.status === "pending" && entry.expiresAt <= now)
        this.finish(entry.id, "expired", "evidence_expired");
    }
  }
  reserve(revision: number, now = Date.now()): Intention | undefined {
    this.expire(now);
    for (const entry of this.entries.values()) {
      if (entry.status === "pending" && entry.revision !== revision)
        this.finish(entry.id, "cancelled", "superseded");
    }
    const next = [...this.entries.values()]
      .filter((e) => e.status === "pending" && e.earliestAttemptAt <= now)
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)[0];
    if (next) next.status = "reserved";
    return next ? { ...next, evidenceIds: [...next.evidenceIds] } : undefined;
  }
  defer(id: string, until: number, reason: string): void {
    const entry = this.entries.get(id);
    if (entry?.status === "reserved")
      Object.assign(entry, { status: "pending", earliestAttemptAt: until, reason });
  }
  finish(id: string, status: IntentionStatus, reason: string): void {
    const entry = this.entries.get(id);
    if (entry) Object.assign(entry, { status, reason });
  }
  snapshot(): Intention[] {
    return [...this.entries.values()].map((e) => ({ ...e, evidenceIds: [...e.evidenceIds] }));
  }
  clear(): void {
    this.entries.clear();
  }
}
