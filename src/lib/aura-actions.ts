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
import {
  classifyMusicSemantics,
  resolveDeicticReference,
  resolvePositionTarget,
} from "@/music/DeicticResolver";

export type AuraActionName =
  | "saveMemory"
  | "playYouTubeMusic"
  | "seekMusic"
  | "stopYouTubeMusic"
  | "getMusicContext";

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
function formatWallClock(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatMediaTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function calculateMusicRelevance(transcript?: string): {
  level: "zero" | "low" | "medium" | "high";
  reason: string;
} {
  const s = playbackState.getState();
  if (!s.currentTrack || (!s.isPlaying && !s.isPaused)) {
    return { level: "zero", reason: "No music is currently active." };
  }

  const sessionEvents = s.temporalEvents.filter((e) => e.sessionId === s.musicSessionId);
  const userUtterances = sessionEvents.filter((e) => e.type === "user_utterance");
  const recentUtterance =
    userUtterances[userUtterances.length - 1]?.metadata?.text || transcript || "";

  if (!recentUtterance) {
    return { level: "low", reason: "Music is playing but user has not spoken recently." };
  }

  const category = classifyMusicSemantics(recentUtterance);

  if (category === "NON_MUSIC_TOPIC") {
    return { level: "zero", reason: "Current request is completely unrelated to music." };
  }

  if (category === "DIRECT_MUSIC_REFERENCE" || category === "PLAYBACK_COMMAND") {
    return { level: "high", reason: "User directly commanded playback or requested track info." };
  }

  if (category === "DEICTIC_MUSIC_REFERENCE") {
    return {
      level: "high",
      reason:
        'User used a deictic phrase (e.g. "this part", "that"), highly likely referring to the current musical moment or recent transition.',
    };
  }

  if (category === "MUSICAL_OBSERVATION" || category === "MUSIC_INFORMATION_REQUEST") {
    return {
      level: "medium",
      reason: "User is making an observation or requesting deeper info about the track.",
    };
  }

  return {
    level: "low",
    reason: "Statement is ambiguous; injecting minimal music state just in case.",
  };
}

export function buildMusicContext(transcript?: string): string {
  const { level: relevance, reason: relevanceReason } = calculateMusicRelevance(transcript);

  const s = playbackState.getState();
  if (relevance === "zero" || !s.currentTrack) {
    if (!s.currentTrack) {
      return `[ACTIVE MUSIC CONTEXT]\nNo music is currently playing.\n[/ACTIVE MUSIC CONTEXT]`;
    }
    return `[ACTIVE MUSIC CONTEXT]
Track: "${s.currentTrack.title}"
Position: ${formatMediaTime(s.positionMs / 1000)}

Only minimal music state is supplied because the current user request is unrelated to music.
[/ACTIVE MUSIC CONTEXT]`;
  }

  const title = s.currentTrack.title || "unknown track";
  const artist = s.currentTrack.artist || "unknown artist";
  const videoId = s.currentTrack.id || "unknown ID";

  let statusStr = "stopped";
  if (s.hasFailed) statusStr = `playback_failed (Error: ${s.failureReason || "Playback failed"})`;
  else if (s.isPlaying) statusStr = "playing";
  else if (s.isPaused) statusStr = "paused";
  else if (s.isLoading || s.isBuffering) statusStr = "preparing";

  const posMinutes = Math.floor((s.positionMs || 0) / 60000);
  const posSeconds = Math.floor(((s.positionMs || 0) % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  const positionStr = `${posMinutes}:${posSeconds}`;

  if (relevance === "low") {
    return `[ACTIVE MUSIC CONTEXT]\nCURRENT MUSIC\nTrack: "${title}" — ${artist}\nPlayback: ${positionStr}\nStatus: ${statusStr}\n[/ACTIVE MUSIC CONTEXT]`;
  }

  const durMinutes = Math.floor((s.currentTrack.durationMs || 0) / 60000);
  const durSeconds = Math.floor(((s.currentTrack.durationMs || 0) % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  const percentage = s.currentTrack.durationMs
    ? Math.round((s.positionMs / s.currentTrack.durationMs) * 100)
    : 0;

  const history = s.history || [];
  const prevTrack = history.length > 0 ? history[history.length - 1] : null;
  const prevString = prevTrack ? `"${prevTrack.title}" by ${prevTrack.artist}` : "None";

  // Temporal Context Processing
  const currentSessionId = s.musicSessionId;
  const sessionEvents = s.temporalEvents.filter((e) => e.sessionId === currentSessionId);
  sessionEvents.sort((a, b) => a.timestamp - b.timestamp);

  const eventLines = sessionEvents
    .filter((e) => e.type !== "user_utterance" && e.type !== "aura_response")
    .map((e) => {
      const timeStr = formatMediaTime(e.mediaTime || 0);
      switch (e.type) {
        case "track_started":
          return `${timeStr} — Playback started.`;
        case "track_paused":
          return `${timeStr} — Playback paused.`;
        case "track_resumed":
          return `${timeStr} — Playback resumed.`;
        case "track_seeked":
          return `${timeStr} — User seeked from ${formatMediaTime(e.metadata?.from || 0)} to ${formatMediaTime(e.metadata?.to || 0)}.`;
        case "track_changed":
          return `${timeStr} — Track changed to "${e.metadata?.title || "unknown"}" by ${e.metadata?.artist || "unknown"}.`;
        case "track_ended":
          return `${timeStr} — Playback ended.`;
        case "section_changed":
          return `${timeStr} — Transitioned to "${e.metadata?.section || "unknown"}".`;
        default:
          return null;
      }
    })
    .filter(Boolean);

  const recentEventsStr =
    eventLines.length > 0 ? eventLines.join("\n") : "No recent events for this session.";

  // Music Perception Context
  const perception = s.perception;
  let momentStr = "Structure data unavailable.";

  if (perception && perception.recentMoments && perception.recentMoments.length > 0) {
    const latestMoment = perception.recentMoments[perception.recentMoments.length - 1];

    // Categorize evidence
    const structural = latestMoment.evidence.filter((e) => e.type === "structural_boundary");
    const acoustic = latestMoment.evidence.filter((e) => e.type !== "structural_boundary");

    let observedStr = `[OBSERVED] at ${formatMediaTime(latestMoment.startMs / 1000)}`;
    let structuralStr =
      structural.length > 0
        ? `[STRUCTURAL] Section: ${latestMoment.section || "Unknown"}`
        : `[STRUCTURAL] None`;
    let acousticStr =
      acoustic.length > 0
        ? `[ACOUSTIC] ${acoustic.map((e) => `${e.type} (${e.source})`).join(", ")}`
        : `[ACOUSTIC] None`;
    let inferenceStr = `[INFERENCE] Transition: ${latestMoment.transition || "none"} | Salience: ${(latestMoment.salience * 100).toFixed(0)}%`;

    momentStr = `${observedStr}\n${structuralStr}\n${acousticStr}\n${inferenceStr}`;
  } else if (perception && perception.structure?.section) {
    const entered = formatMediaTime((perception.structure.sectionStartMs || 0) / 1000);
    const within = formatMediaTime(
      (s.positionMs - (perception.structure.sectionStartMs || 0)) / 1000,
    );
    momentStr = `Current section: ${perception.structure.section}\nEntered: ${entered}\nCurrent position within section: ${within}`;
  }

  // Conversational Events
  const conversationEvents = sessionEvents
    .filter((e) => e.type === "user_utterance" || e.type === "aura_response")
    .slice(-10);
  const convLines = conversationEvents.map((e) => {
    const timeStr = formatMediaTime(e.mediaTime || 0);
    const actor = e.type === "user_utterance" ? "User" : "AURA";
    return `${timeStr} — ${actor}: "${e.metadata?.text || ""}"`;
  });
  const conversationStr =
    convLines.length > 0 ? convLines.join("\n") : "No recent music conversation.";

  let referenceStr = "";
  if (relevance === "high" || relevance === "medium") {
    const userUtterances = sessionEvents.filter((e) => e.type === "user_utterance");
    const recentUtteranceText =
      userUtterances[userUtterances.length - 1]?.metadata?.text || transcript || "";
    if (recentUtteranceText) {
      const resolution = resolveDeicticReference(recentUtteranceText, s, perception?.recentMoments);
      if (resolution.category === "DEICTIC_MUSIC_REFERENCE") {
        referenceStr = `\nREFERENCE\nThe user's phrase "${resolution.reference}" most likely refers to the ${resolution.target}.\nConfidence: ${(resolution.confidence * 100).toFixed(0)}%\n`;
      }
    }
  }

  return `[ACTIVE MUSIC CONTEXT]

CURRENT MUSIC
Track: "${title}" — ${artist} (Video ID: ${videoId})
Playback: ${positionStr} / ${durMinutes}:${durSeconds} (${percentage}%)
Status: ${statusStr}

PREVIOUS MUSIC
${prevString}

MUSICAL MOMENT
${momentStr}

RECENT MUSICAL EVENTS
${recentEventsStr}

RECENT MUSIC CONVERSATION
${conversationStr}
${referenceStr}
MUSIC RELEVANCE:
${relevance}

Reason:
${relevanceReason}

[/ACTIVE MUSIC CONTEXT]`;
}

function sendMusicIntent(
  intent:
    | ({ type: "play" } & MusicIntentPayload & { startAtSeconds?: number })
    | {
        type: "stop";
      },
): Promise<void> {
  return import("@/music/MusicService").then(({ musicService }) =>
    musicService.processIntent(intent),
  );
}

/**
 * Resolve a requested position from action args. Precedence:
 *   1. explicit seconds / positionMs,
 *   2. natural-language timestamp ("1:32"),
 *   3. a named section ("the chorus") or lyric line against current track chapters.
 * Returns seconds (>=0) or null when unresolvable.
 */
function resolveStartSeconds(
  args: Record<string, unknown>,
  currentTrack?: unknown,
): { seconds: number | null; detail?: string } {
  const rawSeconds = args["startAtSeconds"];
  if (typeof rawSeconds === "number" && Number.isFinite(rawSeconds) && rawSeconds >= 0) {
    return { seconds: rawSeconds };
  }

  const fromTimestamp =
    typeof args["fromTimestamp"] === "string" ? (args["fromTimestamp"] as string) : "";
  const fromSection =
    typeof args["fromSection"] === "string" ? (args["fromSection"] as string) : "";
  const fromLyric = typeof args["fromLyric"] === "string" ? (args["fromLyric"] as string) : "";

  const phrase = fromTimestamp || fromSection || fromLyric;
  if (phrase) {
    const rightTrack =
      currentTrack && typeof currentTrack === "object"
        ? (currentTrack as import("@/music/types").Track)
        : undefined;
    const res = resolvePositionTarget(phrase, rightTrack);
    return { seconds: res.seconds, detail: res.reason };
  }
  return { seconds: null };
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

      if (!query && !mood && !genre && !activity && intentValue !== "similar") {
        return { ok: false, result: "Cannot play music: no search criteria provided." };
      }

      const wantStart =
        args["startAtSeconds"] !== undefined ||
        typeof args["fromTimestamp"] === "string" ||
        typeof args["fromSection"] === "string" ||
        typeof args["fromLyric"] === "string";
      const start = wantStart ? resolveStartSeconds(args) : { seconds: null };

      // Await the music intent so we capture actual success/failure
      try {
        await sendMusicIntent({
          type: "play",
          query,
          mood,
          energy,
          genre,
          activity,
          intent: intentValue as any,
          ...(start.seconds !== null ? { startAtSeconds: start.seconds } : {}),
        });
        const finalState = playbackState.getState();
        if (finalState.hasFailed) {
          return {
            ok: false,
            result: `I found track "${finalState.currentTrack?.title || query}" but playback failed: ${finalState.failureReason || "Audio stream could not be started."}`,
            musicContext: buildMusicContext(),
          };
        }
        if (wantStart && start.seconds === null) {
          return {
            ok: false,
            result: `I started "${finalState.currentTrack?.title || query}" from the beginning because I couldn't determine the exact position you asked for. ${start.detail || ""}`,
            musicContext: buildMusicContext(),
          };
        }
        const startedAt =
          start.seconds !== null ? ` started at ${formatMediaTime(start.seconds)}` : "";
        return {
          ok: true,
          result: `Successfully initiated playback for "${finalState.currentTrack?.title || query}"${startedAt}. Current Context:\n${buildMusicContext()}`,
          musicContext: buildMusicContext(),
        };
      } catch (e: any) {
        console.error("[AuraActions] play failed:", e);
        return {
          ok: false,
          result: `I couldn't start the music because the music service is unavailable or the search failed. Error: ${e.message || "Unknown error"}`,
        };
      }
    }

    case "seekMusic": {
      const current = playbackState.getState();
      if (!current.currentTrack) {
        return { ok: false, result: "No music is currently playing to seek." };
      }

      const wantPosition =
        args["positionMs"] !== undefined ||
        args["seconds"] !== undefined ||
        typeof args["fromTimestamp"] === "string" ||
        typeof args["fromSection"] === "string" ||
        typeof args["fromLyric"] === "string";

      if (!wantPosition) {
        return { ok: false, result: "No target position provided for the seek." };
      }

      let targetSeconds: number | null = null;
      let detail: string | undefined;

      if (typeof args["seconds"] === "number" && Number.isFinite(args["seconds"] as number)) {
        targetSeconds = args["seconds"] as number;
      } else if (
        typeof args["positionMs"] === "number" &&
        Number.isFinite(args["positionMs"] as number)
      ) {
        targetSeconds = (args["positionMs"] as number) / 1000;
      } else {
        const res = resolveStartSeconds(args, current.currentTrack);
        targetSeconds = res.seconds;
        detail = res.detail;
      }

      if (targetSeconds === null) {
        return {
          ok: false,
          result: `I couldn't figure out exactly where to seek. ${detail || "The requested position could not be resolved."}`,
          musicContext: buildMusicContext(),
        };
      }

      const durationSec = current.currentTrack.durationMs
        ? current.currentTrack.durationMs / 1000
        : NaN;
      if (Number.isFinite(durationSec) && targetSeconds > durationSec) {
        return {
          ok: false,
          result: `I can't seek to ${formatMediaTime(targetSeconds)} because the track "${current.currentTrack.title}" is only ${formatMediaTime(durationSec)} long.`,
          musicContext: buildMusicContext(),
        };
      }

      try {
        const { musicService } = await import("@/music/MusicService");
        await musicService.seek(targetSeconds * 1000);
        const after = playbackState.getState();
        const verifiedSec = after.positionMs / 1000;
        const actual = Number.isFinite(verifiedSec) ? formatMediaTime(verifiedSec) : "unknown";
        return {
          ok: true,
          result: `Seeking to ${formatMediaTime(targetSeconds)} (now at ${actual}).`,
          musicContext: buildMusicContext(),
        };
      } catch (e: any) {
        console.error("[AuraActions] seek failed:", e);
        return {
          ok: false,
          result: `I couldn't complete the seek: ${e.message || "unknown error"}`,
          musicContext: buildMusicContext(),
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
