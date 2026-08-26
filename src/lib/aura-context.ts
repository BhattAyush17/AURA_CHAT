/**
 * AURA Canonical Cognitive Context (G2)
 *
 * The single assembler that gives every provider the same AURA soul
 * context. Gemini Live uses it today; OpenRouter/Sarvam receive the
 * equivalent blocks server-side via /chat — same semantics, same shape.
 *
 * Sources composed into the canonical context prefix:
 *   1. Memory (client):  MemoryGateway L3 retrieval (local mode) — async,
 *      started in parallel with backend analysis so it never blocks the turn.
 *   2. Memory (server):  ChromaDB enrichment returned by /api/analyze
 *      (memory_enrichment) — already fetched; previously never injected.
 *   3. Music:            [ACTIVE MUSIC CONTEXT] from real playback state.
 *
 * Personality (getSystemPromptForPersonality), behavioral context
 * (behavior_instructions + adaptive modulation + psyche) and L2 layers
 * are already shared across all providers via the same prompt/hook sources.
 */

import { memoryGateway } from "@/lib/memory-gateway";
import { buildMusicContext } from "@/lib/aura-actions";

export interface CognitiveContextSource {
  /** The user's latest utterance — used as the retrieval query. */
  query: string;
  userId: string;
  /** Current emotion mode (calm/engaged/elevated/distressed) for tag matching. */
  emotionalMode?: string;
}

const MAX_MEMORY_CHARS = 1500;

/**
 * Start client-side L3 memory retrieval (MemoryGateway, local mode).
 *
 * Async and cheap (~ms, localStorage + scoring). Call this BEFORE the
 * backend behavior analysis so the two run in parallel — the returned
 * promise is awaited only at assembly time.
 *
 * Supabase mode returns "" by design — the /chat backend owns retrieval
 * there (server-side ChromaDB via memory_enrichment).
 */
export async function startClientMemoryContext(src: CognitiveContextSource): Promise<string> {
  if (!memoryGateway.ready) {
    try {
      await memoryGateway.initialize();
    } catch {
      return "";
    }
  }

  const emotionalState = src.emotionalMode ? { [src.emotionalMode]: 1 } : {};
  try {
    const memories = await memoryGateway.retrieveMemories(src.query, src.userId, emotionalState);
    if (memories.length === 0) return "";

    let total = 0;
    const lines: string[] = [];
    for (const m of memories) {
      const line = `- "${m.content.slice(0, 200)}" (emotional_match: ${m.emotional_match})`;
      if (total + line.length > MAX_MEMORY_CHARS) break;
      lines.push(line);
      total += line.length;
    }
    if (lines.length === 0) return "";
    return `[MEMORY CONTEXT]\n${lines.join("\n")}\n[/MEMORY CONTEXT]`;
  } catch (e) {
    console.warn("[AuraContext] client memory retrieval failed:", e);
    return "";
  }
}

/**
 * Assemble the canonical cognitive context prefix from all available
 * sources. Returns "" when nothing is available — callers inject nothing.
 *
 * @param clientMemoryBlock result of startClientMemoryContext ("" if none)
 * @param backendEnrichment server-side ChromaDB enrichment from /api/analyze
 */
export function assembleCognitiveContext(
  clientMemoryBlock: string,
  backendEnrichment?: string,
): string {
  const parts: string[] = [];

  const server = backendEnrichment?.trim();
  if (server) {
    parts.push(`[MEMORY CONTEXT]\n${server.slice(0, MAX_MEMORY_CHARS)}\n[/MEMORY CONTEXT]`);
  }

  if (clientMemoryBlock) parts.push(clientMemoryBlock);

  const music = buildMusicContext();
  if (music) parts.push(music);

  return parts.join("\n\n");
}
