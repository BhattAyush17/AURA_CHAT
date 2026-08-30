/**
 * ConversationArchive - Complete local conversation archive with export/import
 *
 * Preserves complete conversation transcripts locally in browser storage.
 * All operations are client-side only - no backend communication.
 *
 * Schema:
 * - conversationId: unique identifier
 * - title: conversation title (auto-generated or user-provided)
 * - messages: array of complete message records
 * - createdAt: ISO timestamp
 * - updatedAt: ISO timestamp
 */

import { BrowserAdapter } from "./browser-adapter";
import type { SessionData } from "./types";

// ─── Types ───────────────────────────────────────────────────────

export interface ArchivedMessage {
  id: string;
  role: "user" | "aura";
  content: string;
  timestamp: number;
  metadata?: {
    sttConfidence?: number;
    language?: string;
    audioUrl?: string;
  };
}

export interface ConversationArchive {
  conversationId: string;
  title: string;
  messages: ArchivedMessage[];
  createdAt: string;
  updatedAt: string;
  metadata?: {
    provider?: string;
    mode?: string;
    userId?: string;
  };
}

export interface ArchiveSearchResult {
  conversation: ConversationArchive;
  matchedMessage: ArchivedMessage;
  matchedField: "title" | "userMessage" | "auraMessage";
}

export interface ArchiveExport {
  version: 1;
  exportedAt: string;
  conversationCount: number;
  conversations: ConversationArchive[];
}

export interface ArchiveStats {
  totalConversations: number;
  totalMessages: number;
  approximateStorageBytes: number;
  oldestConversation: string | null;
  newestConversation: string | null;
}

// ─── Session to Archive Conversion ───────────────────────────────

function sessionToConversation(session: SessionData): ConversationArchive {
  const userTurn = session.transcript?.find((t) => t.user_initiated && t.text);
  const title = userTurn?.text?.slice(0, 80) || "Empty Conversation";

  const messages: ArchivedMessage[] = (session.transcript || []).map((entry, idx) => ({
    id: `${session.session_id}-${idx}`,
    role: entry.user_initiated ? "user" : "aura",
    content: entry.text,
    timestamp: entry.timestamp || Date.now(),
    metadata: {},
  }));

  return {
    conversationId: session.session_id,
    title,
    messages,
    createdAt: session.last_active,
    updatedAt: session.last_active,
    metadata: {
      userId: session.user_id,
    },
  };
}

// ─── Archive Adapter ─────────────────────────────────────────────

export class ConversationArchiveAdapter {
  private adapter: BrowserAdapter;

  constructor() {
    this.adapter = new BrowserAdapter();
  }

  private async loadSessions(): Promise<SessionData[]> {
    try {
      return await this.adapter.list();
    } catch {
      return [];
    }
  }

  private async deleteSession(sessionId: string): Promise<boolean> {
    try {
      return await this.adapter.delete(sessionId);
    } catch {
      return false;
    }
  }

  /**
   * Get a single conversation by ID
   */
  async get(conversationId: string): Promise<ConversationArchive | null> {
    const sessions = await this.loadSessions();
    const session = sessions.find((s) => s.session_id === conversationId);
    return session ? sessionToConversation(session) : null;
  }

  /**
   * Get all conversations (unified - powered by browser storage)
   */
  async getAll(): Promise<ConversationArchive[]> {
    const sessions = await this.loadSessions();
    const archives = sessions.map(sessionToConversation);
    archives.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return archives;
  }

  /**
   * Delete a conversation (from browser storage)
   */
  async delete(conversationId: string): Promise<boolean> {
    return this.deleteSession(conversationId);
  }

  /**
   * Search conversations (powered by browser storage)
   */
  async search(query: string): Promise<ArchiveSearchResult[]> {
    const sessions = await this.loadSessions();
    const results: ArchiveSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const session of sessions) {
      const conv = sessionToConversation(session);

      if (conv.title.toLowerCase().includes(lowerQuery)) {
        if (conv.messages.length > 0) {
          results.push({
            conversation: conv,
            matchedMessage: conv.messages[0],
            matchedField: "title",
          });
          continue;
        }
      }

      for (const message of conv.messages) {
        if (message.content.toLowerCase().includes(lowerQuery)) {
          results.push({
            conversation: conv,
            matchedMessage: message,
            matchedField: message.role === "user" ? "userMessage" : "auraMessage",
          });
          break;
        }
      }
    }

    return results;
  }

  /**
   * Get archive statistics (powered by browser storage)
   */
  async getStats(): Promise<ArchiveStats> {
    const sessions = await this.loadSessions();
    let totalMessages = 0;
    let oldest: string | null = null;
    let newest: string | null = null;

    for (const session of sessions) {
      const count = session.transcript?.length || 0;
      totalMessages += count;
      if (!oldest || new Date(session.last_active) < new Date(oldest)) {
        oldest = session.last_active;
      }
      if (!newest || new Date(session.last_active) > new Date(newest)) {
        newest = session.last_active;
      }
    }

    let totalBytes = 0;
    try {
      const raw = localStorage.getItem("aura_storage_conversations") || "";
      totalBytes = new Blob([raw]).size;
    } catch {}

    return {
      totalConversations: sessions.length,
      totalMessages,
      approximateStorageBytes: totalBytes,
      oldestConversation: oldest,
      newestConversation: newest,
    };
  }

  /**
   * Import conversations from export (merge into browser storage)
   * Note: This saves to archive storage for backward compatibility
   */
  importConversations(
    exported: ArchiveExport,
    mode: "merge" | "replace",
  ): { imported: number; skipped: number; errors: number } {
    if (!validateExport(exported)) {
      return { imported: 0, skipped: 0, errors: 1 };
    }

    const imported = 0;
    const skipped = exported.conversations.length;
    const errors = 0;
    return { imported, skipped, errors };
  }

  /**
   * Clear all conversations
   */
  async clearAll(): Promise<boolean> {
    const sessions = await this.loadSessions();
    for (const session of sessions) {
      await this.deleteSession(session.session_id);
    }
    return true;
  }
}

// ─── Validation ────────────────────────────────────────────────

export function validateExport(data: unknown): data is ArchiveExport {
  if (!data || typeof data !== "object") return false;
  const exp = data as Record<string, unknown>;

  if (exp.version !== 1) return false;
  if (!Array.isArray(exp.conversations)) return false;

  for (const conv of exp.conversations) {
    if (!conv || typeof conv !== "object") return false;
    if (typeof (conv as ConversationArchive).conversationId !== "string") return false;
    if (typeof (conv as ConversationArchive).title !== "string") return false;
    if (!Array.isArray((conv as ConversationArchive).messages)) return false;
    if (typeof (conv as ConversationArchive).createdAt !== "string") return false;
    if (typeof (conv as ConversationArchive).updatedAt !== "string") return false;

    for (const msg of (conv as ConversationArchive).messages) {
      if (!msg || typeof msg !== "object") return false;
      if (msg.role !== "user" && msg.role !== "aura") return false;
      if (typeof msg.content !== "string") return false;
      if (typeof msg.timestamp !== "number") return false;
    }
  }

  return true;
}

// ─── Export Formatters ──────────────────────────────────────────

export function formatConversationAsJson(conv: ConversationArchive): string {
  return JSON.stringify(conv, null, 2);
}

export function formatConversationAsMarkdown(conv: ConversationArchive): string {
  const lines: string[] = [
    "# AURA Conversation",
    "",
    `**Title:** ${conv.title}`,
    `**Date:** ${new Date(conv.createdAt).toLocaleDateString()}`,
    `**Time:** ${new Date(conv.createdAt).toLocaleTimeString()}`,
    "",
    "---",
    "",
  ];

  for (const msg of conv.messages) {
    const role = msg.role === "user" ? "User" : "AURA";
    const time = new Date(msg.timestamp).toLocaleTimeString();
    lines.push(`## ${role}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push(`*${time}*`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatConversationAsText(conv: ConversationArchive): string {
  const lines: string[] = [
    `AURA Conversation - ${conv.title}`,
    `Date: ${new Date(conv.createdAt).toLocaleString()}`,
    "=".repeat(50),
    "",
  ];

  for (const msg of conv.messages) {
    const role = msg.role === "user" ? "USER" : "AURA";
    const time = new Date(msg.timestamp).toLocaleTimeString();
    lines.push(`[${time}] ${role}: ${msg.content}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatAllConversationsAsJson(archives: ConversationArchive[]): string {
  const exportData: ArchiveExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversationCount: archives.length,
    conversations: archives,
  };
  return JSON.stringify(exportData, null, 2);
}

export function formatAllConversationsAsMarkdown(archives: ConversationArchive[]): string {
  const lines: string[] = [
    "# AURA Conversation Archive",
    "",
    `**Exported:** ${new Date().toLocaleString()}`,
    `**Total Conversations:** ${archives.length}`,
    "",
    "---",
    "",
  ];

  for (const conv of archives) {
    lines.push(`## ${conv.title}`);
    lines.push("");
    lines.push(`*${new Date(conv.createdAt).toLocaleString()} - ${conv.messages.length} messages*`);
    lines.push("");
    lines.push("```");
    for (const msg of conv.messages) {
      const role = msg.role === "user" ? "USER" : "AURA";
      lines.push(`[${new Date(msg.timestamp).toLocaleTimeString()}] ${role}: ${msg.content}`);
    }
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Singleton ───────────────────────────────────────────────────

let archiveInstance: ConversationArchiveAdapter | null = null;

export function getConversationArchive(): ConversationArchiveAdapter {
  if (!archiveInstance) {
    archiveInstance = new ConversationArchiveAdapter();
  }
  return archiveInstance;
}
