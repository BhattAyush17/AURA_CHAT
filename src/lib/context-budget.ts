/**
 * Context Window Budget Manager
 *
 * Prevents the Gemini conversation context from growing unbounded.
 * Ensures all layers (L1 system, L2 behavioral, L3 live, memories,
 * conversation history) fit within an optimal token budget.
 *
 * All methods are pure functions — no side effects, easy to test.
 * Token estimation is pure math (<1ms, no API calls).
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
}

export interface MemoryEntry {
  text: string;
  score: number;
  age_hours: number;
}

export interface ContextBudget {
  systemPrompt: number; // Layer 1 — fixed identity
  behavioralLayer: number; // Layer 2 — variable but bounded
  liveContext: number; // Layer 3 — tiny XML tag
  memoryEnrichment: number; // Retrieved memories from pgvector
  behaviorInjection: number; // Sensing directives
  conversationHistory: number; // Recent turns (truncated first)
  safetyMargin: number; // Buffer for Gemini overhead
}

interface BucketUsage {
  tokens: number;
  budget: number;
}

export interface ContextUsageReport {
  systemPrompt: BucketUsage;
  behavioral: BucketUsage;
  liveContext: BucketUsage;
  memories: BucketUsage;
  injection: BucketUsage;
  history: BucketUsage;
  total: number;
  totalBudget: number;
  utilizationPercent: number;
}

// ─── Defaults ───────────────────────────────────────────────────────

export const DEFAULT_BUDGET: ContextBudget = {
  systemPrompt: 500,
  behavioralLayer: 300,
  liveContext: 100,
  memoryEnrichment: 400,
  behaviorInjection: 200,
  conversationHistory: 2500,
  safetyMargin: 500,
  // Total: ~4500 tokens — fast response range for Gemini Flash
};

// ─── Token estimation ───────────────────────────────────────────────

/** Fast token approximation: ~3.5 chars/token for mixed English/Hindi. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

// ─── Budget Manager ─────────────────────────────────────────────────

export class ContextBudgetManager {
  private budget: ContextBudget;

  constructor(budget: Partial<ContextBudget> = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  /**
   * Truncate conversation history to fit within budget.
   * Keeps: first turn (opening context) + most recent turns.
   * Drops: middle turns with a marker.
   */
  truncateHistory(turns: ConversationTurn[]): ConversationTurn[] {
    if (turns.length <= 2) return turns;

    const budget = this.budget.conversationHistory;
    const first = turns[0];
    let used = estimateTokens(first.text);

    // Fill from the end (most recent turns are most relevant)
    const recent: ConversationTurn[] = [];
    for (let i = turns.length - 1; i >= 1; i--) {
      const cost = estimateTokens(turns[i].text);
      if (used + cost > budget) break;
      used += cost;
      recent.unshift(turns[i]);
    }

    // Nothing dropped — return as-is
    const dropped = turns.length - 1 - recent.length;
    if (dropped === 0) return turns;

    return [
      first,
      {
        role: "system" as const,
        text: `[${dropped} earlier turns omitted for context efficiency]`,
        timestamp: 0,
      },
      ...recent,
    ];
  }

  /**
   * Truncate memory enrichment to fit budget.
   * Assumes memories are pre-sorted by final_score (highest first).
   */
  truncateMemories(memories: MemoryEntry[]): MemoryEntry[] {
    const budget = this.budget.memoryEnrichment;
    let used = 0;
    const kept: MemoryEntry[] = [];

    for (const mem of memories) {
      const cost = estimateTokens(mem.text);
      if (used + cost > budget) break;
      used += cost;
      kept.push(mem);
    }
    return kept;
  }

  /**
   * Full context usage report for debugging.
   * Log every N turns to monitor budget utilization.
   */
  getUsageReport(components: {
    systemPrompt: string;
    behavioral: string;
    liveContext: string;
    memories: string;
    injection: string;
    history: ConversationTurn[];
  }): ContextUsageReport {
    const sp = estimateTokens(components.systemPrompt);
    const bh = estimateTokens(components.behavioral);
    const lc = estimateTokens(components.liveContext);
    const mm = estimateTokens(components.memories);
    const ij = estimateTokens(components.injection);
    const ht = components.history.reduce((s, t) => s + estimateTokens(t.text), 0);
    const total = sp + bh + lc + mm + ij + ht + this.budget.safetyMargin;
    const totalBudget = Object.values(this.budget).reduce((a, b) => a + b, 0);

    return {
      systemPrompt: { tokens: sp, budget: this.budget.systemPrompt },
      behavioral: { tokens: bh, budget: this.budget.behavioralLayer },
      liveContext: { tokens: lc, budget: this.budget.liveContext },
      memories: { tokens: mm, budget: this.budget.memoryEnrichment },
      injection: { tokens: ij, budget: this.budget.behaviorInjection },
      history: { tokens: ht, budget: this.budget.conversationHistory },
      total,
      totalBudget,
      utilizationPercent: Math.round((total / totalBudget) * 100),
    };
  }
}
