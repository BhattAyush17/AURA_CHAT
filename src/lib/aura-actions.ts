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
import { queueManager } from "@/music/QueueManager";
import { MusicIntentPayload } from "@/music/types";

export type AuraActionName = "saveMemory" | "playYouTubeMusic" | "stopYouTubeMusic" | "getMusicContext";

export interface AuraActionResult {
  ok: boolean;
  result: string;
  musicContext?: string;
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
  if (!s.currentTrack) {
    return `[ACTIVE MUSIC CONTEXT]
No music is currently playing.
[/ACTIVE MUSIC CONTEXT]`;
  }

  const title = s.currentTrack.title || "unknown track";
  const artist = s.currentTrack.artist || "unknown artist";
  const videoId = s.currentTrack.id || "unknown ID";
  const status = s.isPaused ? "paused" : s.isBuffering || s.isLoading ? "loading" : s.isPlaying ? "playing" : "stopped";

  const posMinutes = Math.floor((s.positionMs || 0) / 60000);
  const posSeconds = Math.floor(((s.positionMs || 0) % 60000) / 1000).toString().padStart(2, '0');
  const durMinutes = Math.floor((s.currentTrack.durationMs || 0) / 60000);
  const durSeconds = Math.floor(((s.currentTrack.durationMs || 0) % 60000) / 1000).toString().padStart(2, '0');
  const percentage = s.currentTrack.durationMs ? Math.round((s.positionMs / s.currentTrack.durationMs) * 100) : 0;

  const history = s.history || [];
  const historyString = history.map((t, idx) => `${idx + 1}. "${t.title}" by ${t.artist}`).join(", ") || "None";
  const prevTrack = history.length > 0 ? history[history.length - 1] : null;
  const prevString = prevTrack ? `"${prevTrack.title}" by ${prevTrack.artist}` : "None";

  const queue = queueManager.getQueue();
  const currentIdx = queueManager.getCurrentIdx();
  const nextTrack = currentIdx >= 0 && currentIdx < queue.length - 1 ? queue[currentIdx + 1] : null;
  const nextString = nextTrack ? `"${nextTrack.title}" by ${nextTrack.artist}` : "None";

  const queueString = queue.map((t, idx) => `${idx === currentIdx ? '👉 ' : ''}${idx + 1}. "${t.title}" by ${t.artist}`).join("\n") || "Empty";
  const queuePos = queue.length > 0 ? `${currentIdx + 1} of ${queue.length}` : "N/A";

  const intentParts: string[] = [];
  if (s.currentTrack.mood) intentParts.push(`mood: ${s.currentTrack.mood}`);
  if (s.currentTrack.energy) intentParts.push(`energy: ${s.currentTrack.energy}`);
  if (s.currentTrack.genre) intentParts.push(`genre: ${s.currentTrack.genre}`);
  if (s.currentTrack.activity) intentParts.push(`activity: ${s.currentTrack.activity}`);
  const intentString = intentParts.join(", ") || "None";

  return `[ACTIVE MUSIC CONTEXT]
Now playing: "${title}" — ${artist}
Video ID: ${videoId}
State: ${status}
Position: ${posMinutes}:${posSeconds} / ${durMinutes}:${durSeconds} (${percentage}%)
Queue position: ${queuePos}
Queue:
${queueString}
Previous: ${prevString}
Next: ${nextString}
History: ${historyString}
Intent Metadata: ${intentString}
[/ACTIVE MUSIC CONTEXT]`;
}

function sendMusicIntent(
  intent: ({ type: "play" } & MusicIntentPayload) | { type: "stop" },
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
    case "getMusicContext": {
      return { ok: true, result: buildMusicContext() };
    }

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
      const mood = typeof args.mood === "string" ? args.mood.trim() : undefined;
      const energy = typeof args.energy === "string" ? args.energy.trim() : undefined;
      const genre = typeof args.genre === "string" ? args.genre.trim() : undefined;
      const activity = typeof args.activity === "string" ? args.activity.trim() : undefined;
      const intentValue = typeof args.intent === "string" ? args.intent.trim() : undefined;

      if (!query && !mood && !genre && !activity && intentValue !== 'similar') {
        return { ok: false, result: "Cannot play music: no search criteria provided." };
      }

      // Await the music intent so we capture actual success/failure
      try {
        await sendMusicIntent({ 
          type: "play", 
          query, 
          mood, 
          energy, 
          genre, 
          activity, 
          intent: intentValue as any 
        });
        return {
          ok: true,
          result: `Successfully initiated playback. The music is starting now. Current Context: \n${buildMusicContext()}`,
          musicContext: buildMusicContext()
        };
      } catch (e: any) {
        console.error("[AuraActions] play failed:", e);
        return {
          ok: false,
          result: `I couldn't start the music because the music service is unavailable or the search failed. Error: ${e.message || "Unknown error"}`,
        };
      }
    }

    case "stopYouTubeMusic": {
      try {
        await sendMusicIntent({ type: "stop" });
        return {
          ok: true,
          result: "Music stopped.",
        };
      } catch (e: any) {
        console.error("[AuraActions] stop failed:", e);
        return {
          ok: false,
          result: `Failed to stop music: ${e.message || "Unknown error"}`,
        };
      }
    }
  }
}
