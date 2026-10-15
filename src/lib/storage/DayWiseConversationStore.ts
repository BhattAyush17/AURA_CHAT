/**
 * DayWiseConversationStore — day-wise chat persistence in localStorage.
 *
 * Every conversational turn is saved under a day key (`aura_chat_day_YYYY-MM-DD`)
 * with per-message timestamps. On the user's next arrival the store restores
 * context so the conversation never gets lost:
 *
 *   - Fresh days (last FRESH_DAYS): full transcript turns, restored into the
 *     LLM message buffer so context continues seamlessly.
 *   - Older days: core details extracted into a bounded day summary
 *     (`aura_chat_summ_YYYY-MM-DD`); raw turns are trimmed to bound storage.
 *
 * Summarization is heuristic and deterministic (client-side, fail-open): user
 * questions, first-person facts, plans, and emotional moments survive; the
 * raw text is dropped once summarized. No network dependency, never blocks
 * the voice path.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface DayMessage {
  role: "user" | "assistant";
  content: string;
  /** Epoch ms when the turn happened. */
  timestamp: number;
}

export interface DayConversation {
  /** Local date string, YYYY-MM-DD. */
  day: string;
  messages: DayMessage[];
  updatedAt: number;
}

export interface DaySummary {
  /** Local date string, YYYY-MM-DD. */
  day: string;
  /** Extracted core details (bounded bullet digest). */
  summary: string;
  messageCount: number;
  summarizedAt: number;
}

export interface RestoredContext {
  /** Full turns from the fresh window, oldest first. */
  recentTurns: DayMessage[];
  /** Summaries for days older than the fresh window, oldest first. */
  summaries: DaySummary[];
}

// ─── Configuration ───────────────────────────────────────────────────

const DAY_KEY_PREFIX = "aura_chat_day_";
const SUMMARY_KEY_PREFIX = "aura_chat_summ_";
/** Last N days keep their full transcript active (fresh window). */
const FRESH_DAYS = 3;
/** At most this many summarized days are retained (oldest beyond are dropped). */
const MAX_SUMMARY_DAYS = 30;
/** Per-day raw message cap to bound localStorage growth. */
const MAX_MESSAGES_PER_DAY = 200;
/** Summary digest bounds. */
const MAX_SUMMARY_BULLETS = 8;
const MAX_BULLET_CHARS = 140;

// ─── Date helpers ────────────────────────────────────────────────────

function dayKeyFor(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeLabelFor(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function daysAgoKey(daysBack: number, now: number): string {
  return dayKeyFor(now - daysBack * 86_400_000);
}

function isFreshDay(day: string, now: number): boolean {
  for (let i = 0; i < FRESH_DAYS; i++) {
    if (day === daysAgoKey(i, now)) return true;
  }
  return false;
}

// ─── Core-details extraction (heuristic, deterministic) ─────────────

const QUESTION_RE =
  /^(what|who|where|when|why|how|is|are|do|does|did|can|could|would|should|will|shall|have|has|had|kya|kaisa|kaise|kab|kaun|kyun)\b/i;

const PERSONAL_FACT_RE =
  /\b(i|i'm|im|my|me|mine|we|need|want|like|love|hate|plan|planning|feel|feeling|hurts?|miss|afraid|scared|anxious|happy|sad|angry|frustrated|lonely|excited|thinking|going|going to|mera|meri|mere|mujhe|hum|hona|chahiye)\b/i;

function extractCoreDetails(messages: DayMessage[]): string {
  const bullets: string[] = [];
  const seen = new Set<string>();

  const push = (label: string, text: string, ts: number) => {
    const trimmed = text.trim().replace(/\s+/g, " ").slice(0, MAX_BULLET_CHARS);
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bullets.push(`[${timeLabelFor(ts)}] ${label}${trimmed}`);
  };

  // Pass 1: user questions
  for (const m of messages) {
    if (bullets.length >= MAX_SUMMARY_BULLETS) break;
    if (m.role !== "user") continue;
    if (m.content.trim().endsWith("?") || QUESTION_RE.test(m.content)) {
      push("Asked: ", m.content, m.timestamp);
    }
  }

  // Pass 2: first-person facts / plans / emotional moments
  if (bullets.length < MAX_SUMMARY_BULLETS) {
    for (const m of messages) {
      if (bullets.length >= MAX_SUMMARY_BULLETS) break;
      if (m.role !== "user") continue;
      if (QUESTION_RE.test(m.content)) continue;
      if (PERSONAL_FACT_RE.test(m.content)) {
        push("Shared: ", m.content, m.timestamp);
      }
    }
  }

  // Pass 3: fill with earliest user turns if still thin
  if (bullets.length < 3) {
    for (const m of messages) {
      if (bullets.length >= 3) break;
      if (m.role !== "user") continue;
      push("Talked about: ", m.content, m.timestamp);
    }
  }

  return bullets.join("\n");
}

// ─── Storage helpers (fail-open) ─────────────────────────────────────

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or unavailable — fail open, never block the voice path.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

// ─── The Store ───────────────────────────────────────────────────────

export class DayWiseConversationStore {
  /** Append one turn under its day key. */
  appendTurn(role: "user" | "assistant", content: string, timestamp: number): void {
    if (!content || !content.trim()) return;
    const day = dayKeyFor(timestamp);
    const key = DAY_KEY_PREFIX + day;

    let messages: DayMessage[] = [];
    try {
      const raw = safeGet(key);
      if (raw) messages = JSON.parse(raw);
    } catch {}

    messages.push({ role, content, timestamp });
    if (messages.length > MAX_MESSAGES_PER_DAY) {
      messages = messages.slice(-MAX_MESSAGES_PER_DAY);
    }

    const conv: DayConversation = { day, messages, updatedAt: Date.now() };
    safeSet(key, JSON.stringify(conv));
  }

  /** List all stored day keys, newest first. */
  private listDays(): string[] {
    const days: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(DAY_KEY_PREFIX)) {
          days.push(key.slice(DAY_KEY_PREFIX.length));
        }
      }
    } catch {}
    return days.sort((a, b) => (a < b ? 1 : -1));
  }

  private loadDay(day: string): DayConversation | null {
    try {
      const raw = safeGet(DAY_KEY_PREFIX + day);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }

  private loadSummary(day: string): DaySummary | null {
    try {
      const raw = safeGet(SUMMARY_KEY_PREFIX + day);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }

  /**
   * Consolidate: for every day older than the fresh window, extract core
   * details into a summary and trim the raw turns. Caps the summary count.
   */
  consolidate(now: number = Date.now()): void {
    const days = this.listDays();

    for (const day of days) {
      if (isFreshDay(day, now)) continue;

      const existingSummary = this.loadSummary(day);
      if (existingSummary) {
        // Already summarized — raw turns were trimmed at summarization time.
        continue;
      }

      const conv = this.loadDay(day);
      if (!conv || conv.messages.length === 0) {
        safeRemove(DAY_KEY_PREFIX + day);
        continue;
      }

      const summary = extractCoreDetails(conv.messages);
      const daySummary: DaySummary = {
        day,
        summary,
        messageCount: conv.messages.length,
        summarizedAt: now,
      };
      safeSet(SUMMARY_KEY_PREFIX + day, JSON.stringify(daySummary));
      // Raw turns are now represented by the summary — trim them.
      safeRemove(DAY_KEY_PREFIX + day);
    }

    // Cap the number of retained summarized days.
    const summaryDays: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(SUMMARY_KEY_PREFIX)) {
          summaryDays.push(key.slice(SUMMARY_KEY_PREFIX.length));
        }
      }
    } catch {}
    summaryDays.sort((a, b) => (a < b ? 1 : -1));
    for (const day of summaryDays.slice(MAX_SUMMARY_DAYS)) {
      safeRemove(SUMMARY_KEY_PREFIX + day);
    }
  }

  /**
   * Restore conversation context: full turns from the fresh window plus
   * summaries for older days. Runs consolidation first. Oldest-first ordering.
   */
  restoreContext(now: number = Date.now()): RestoredContext {
    this.consolidate(now);

    const recentTurns: DayMessage[] = [];
    const summaries: DaySummary[] = [];

    for (const day of this.listDays()) {
      if (isFreshDay(day, now)) {
        const conv = this.loadDay(day);
        if (conv) recentTurns.push(...conv.messages);
      } else {
        const s = this.loadSummary(day);
        if (s && s.summary) summaries.push(s);
      }
    }

    recentTurns.sort((a, b) => a.timestamp - b.timestamp);
    summaries.sort((a, b) => (a.day < b.day ? -1 : 1));

    return { recentTurns, summaries };
  }

  /**
   * Format a past-context block for LLM injection: older-day summaries plus
   * an optional digest of the fresh window. Bounded and deterministic.
   */
  buildContextBlock(ctx: RestoredContext, freshDigestTurns: number = 10): string {
    const lines: string[] = [];

    if (ctx.summaries.length > 0) {
      lines.push("[PAST CONVERSATIONS — restored from local history]");
      lines.push("Older days (summarized core details):");
      for (const s of ctx.summaries.slice(-10)) {
        const digest = s.summary.replace(/\n/g, "; ");
        lines.push(`- ${s.day}: ${digest}`);
      }
    }

    if (ctx.recentTurns.length > 0) {
      lines.push("Recent days (full context below as message history):");
      // A brief digest of the most recent turns for quick orientation.
      for (const t of ctx.recentTurns.slice(-freshDigestTurns)) {
        const who = t.role === "user" ? "User" : "AURA";
        const trimmed = t.content.trim().replace(/\s+/g, " ").slice(0, MAX_BULLET_CHARS);
        if (trimmed) lines.push(`- [${timeLabelFor(t.timestamp)}] ${who}: ${trimmed}`);
      }
    }

    return lines.join("\n");
  }

  /** Get stats for diagnostics. */
  getStats(): {
    dayCount: number;
    summaryCount: number;
    freshDays: number;
    approximateStorageBytes: number;
  } {
    const now = Date.now();
    const days = this.listDays();
    let summaryCount = 0;
    let bytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(DAY_KEY_PREFIX) || key.startsWith(SUMMARY_KEY_PREFIX))) {
          bytes += new Blob([safeGet(key) || ""]).size;
          if (key.startsWith(SUMMARY_KEY_PREFIX)) summaryCount++;
        }
      }
    } catch {}
    return {
      dayCount: days.length,
      summaryCount,
      freshDays: days.filter((d) => isFreshDay(d, now)).length,
      approximateStorageBytes: bytes,
    };
  }

  /** Wipe all day-wise data (called on explicit user data clear). */
  clearAll(): void {
    const days = this.listDays();
    for (const day of days) safeRemove(DAY_KEY_PREFIX + day);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(SUMMARY_KEY_PREFIX)) safeRemove(key);
      }
    } catch {}
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let storeInstance: DayWiseConversationStore | null = null;

export function getDayWiseStore(): DayWiseConversationStore {
  if (!storeInstance) {
    storeInstance = new DayWiseConversationStore();
  }
  return storeInstance;
}
