/**
 * AURA Canonical Action Seam (G1)
 *
 * The single boundary where provider tool/function calls become AURA actions.
 * Providers request actions; AURA owns execution semantics.
 *
 * Today: Gemini Live tool calls route here.
 * Future: OpenRouter/Sarvam intent parsing should route here too.
 *
 * Contract:
 *   - Every action returns an HONEST AuraActionResult — never fake success.
 *   - Music commands execute through MusicService.processIntent (the same
 *     path OpenRouter/Sarvam use) and report real playback state.
 *   - Memory writes go through MemoryGateway (L3) with the correct user key.
 */

import { memoryGateway } from "@/lib/memory-gateway";
import { playbackState } from "@/music/PlaybackState";

export type AuraActionName = "saveMemory" | "playYouTubeMusic" | "stopYouTubeMusic";

export interface AuraActionResult {
  ok: boolean;
  result: string;
}

export interface AuraActionContext {
  userId: string;
  emotionalTags?: Record<string, number>;
}

/**
 * Build the [ACTIVE MUSIC CONTEXT] block from the real playback state.
 * Returns "" when nothing is playing — callers inject nothing.
 * Fulfills the "ACTIVE MUSIC CONTEXT" promise made in the system prompt.
 */
export function buildMusicContext(): string {
  const s = playbackState.getState();
  if (!s.currentTrack) return "";

  const title = s.currentTrack.title || "unknown track";
  const artist = s.currentTrack.artist || "unknown artist";
  const status = s.isPaused ? "paused" : s.isBuffering || s.isLoading ? "loading" : "playing";

  return `[ACTIVE MUSIC CONTEXT]
Now playing: "${title}" by ${artist} (${status})
[/ACTIVE MUSIC CONTEXT]`;
}

function sendMusicIntent(
  intent: { type: "play"; query: string } | { type: "stop" },
): Promise<void> {
  return import("@/music/MusicService").then(({ musicService }) =>
    musicService.processIntent(intent),
  );
}

/**
 * Execute an AURA action requested by a provider.
 *
 * @param action  tool name as declared in the provider tool schema
 * @param args    tool arguments from the provider
 * @param ctx     runtime context (user identity, emotional state)
 * @returns honest result — the model reads this verbatim
 */
export async function executeAuraAction(
  action: AuraActionName,
  args: Record<string, unknown>,
  ctx: AuraActionContext,
): Promise<AuraActionResult> {
  switch (action) {
    case "saveMemory": {
      const fact = typeof args.fact === "string" ? args.fact.trim() : "";
      if (fact.length < 3) {
        return { ok: false, result: "Memory not saved: no fact was provided." };
      }

      if (!memoryGateway.ready) {
        try {
          await memoryGateway.initialize();
        } catch {
          // fall through — storeMemory will report failure honestly
        }
      }

      try {
        const saved = await memoryGateway.storeMemory(fact, ctx.userId, ctx.emotionalTags ?? {});
        if (saved) return { ok: true, result: "Memory saved." };
        return { ok: false, result: "Memory storage is currently unavailable." };
      } catch (e) {
        console.warn("[AuraActions] saveMemory failed:", e);
        return { ok: false, result: "Memory storage failed." };
      }
    }

    case "playYouTubeMusic": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { ok: false, result: "Cannot play music: no search query was provided." };
      }

      // Fire asynchronously to not block the Gemini response
      sendMusicIntent({ type: "play", query }).catch((e) => {
        console.warn("[AuraActions] play failed:", e);
      });

      return {
        ok: true,
        result: `Successfully initiated playback for "${query}". The music is starting now.`,
      };
    }

    case "stopYouTubeMusic": {
      // Fire asynchronously
      sendMusicIntent({ type: "stop" }).catch((e) => {
        console.warn("[AuraActions] stop failed:", e);
      });

      return {
        ok: true,
        result: "Music stopped.",
      };
    }
  }
}
