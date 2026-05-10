/**
 * Usage Tracker - 5-Conversation Gate & Usage Stats
 * Isolate gate state from sensitive credentials.
 */

const GATE_THRESHOLD = 5;
const GATE_KEY = (userId: string) => `aura_conversation_count_${userId}`;
const USAGE_STATS_KEY = (userId: string) => `aura_usage_stats_${userId}`;

export interface UsageStats {
  conversations: number;
  messagesTotal: number;
  lastUpdated: number;
}

/**
 * Gate state lives in localStorage — persists across tabs and sessions.
 * This is intentional — it must survive credential wipes.
 */
export function getConversationCount(userId: string): number {
  try {
    const raw = localStorage.getItem(GATE_KEY(userId));
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

export function incrementConversationCount(userId: string): number {
  const current = getConversationCount(userId);
  const next = current + 1;
  localStorage.setItem(GATE_KEY(userId), String(next));
  return next;
}

export function hasReachedGate(userId: string): boolean {
  return getConversationCount(userId) >= GATE_THRESHOLD;
}

export function isCloudSyncEnabled(): boolean {
  return sessionStorage.getItem("supabase_url") !== null;
}

// Alias for older code compatibility
export const isCloudSyncAvailable = isCloudSyncEnabled;

export function shouldShowSetupPrompt(userId: string): boolean {
  return hasReachedGate(userId) && !isCloudSyncEnabled();
}

/**
 * Usage Stats Management
 */
export function getUsageStats(userId: string): UsageStats {
  try {
    const raw = localStorage.getItem(USAGE_STATS_KEY(userId));
    if (!raw) return { conversations: 0, messagesTotal: 0, lastUpdated: Date.now() };
    return JSON.parse(raw);
  } catch {
    return { conversations: 0, messagesTotal: 0, lastUpdated: Date.now() };
  }
}

export function incrementUsage(userId: string, type: "conversation" | "message") {
  const stats = getUsageStats(userId);
  if (type === "conversation") stats.conversations++;
  else stats.messagesTotal++;
  stats.lastUpdated = Date.now();
  localStorage.setItem(USAGE_STATS_KEY(userId), JSON.stringify(stats));
}
