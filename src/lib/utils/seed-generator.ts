import { Turn, SeedData, SEED_VERSION } from "../storage/types";

/**
 * Seed Generator - Fully synchronous, rule-based behavioral engine
 * This handles the transition from raw conversation to a persistent AI identity.
 */

export function generateSeed(transcript: Turn[], previousSeed?: SeedData): SeedData {
  // Only use turns with text
  const validTurns = transcript.filter((t) => t.text && t.text.trim().length > 0);
  const recent = validTurns.slice(-10);
  const userTurns = recent.filter((t) => t.user_initiated);

  const who = inferWho(recent, previousSeed);
  const carries = extractCarries(userTurns);
  const avoids = detectAvoidance(recent);
  const last = userTurns.at(-1)?.text.slice(0, 60) ?? "";
  const shift = detectShift(recent, previousSeed);
  const thread = extractThread(userTurns);

  const seed = `[SEED]
WHO: ${who}
CARRIES: ${carries}
AVOIDS: ${avoids}
LAST: ${last}
SHIFT: ${shift}
THREAD: ${thread}
[/SEED]`;

  const result: SeedData = {
    version: SEED_VERSION, // always stamp current version
    seed,
    auraState: deriveAuraState(recent),
    growth: updateGrowth(recent, previousSeed?.growth ?? []),
    updatedAt: Date.now(),
  };

  // Runtime assertion — catches any future code path that
  // somehow produces a seed without the version field
  if (result.version !== SEED_VERSION) {
    throw new Error(`generateSeed produced wrong version: ${result.version}`);
  }

  return result;
}

function inferWho(turns: Turn[], prev?: SeedData): string {
  const userText = turns
    .filter((t) => t.user_initiated)
    .map((t) => t.text)
    .join(" ")
    .toLowerCase();

  if (/\b(yeah|idk|fine|whatever|i guess|not really|sure i guess|doesn't matter)\b/.test(userText))
    return "cautious, testing trust";
  if (
    /\b(never|always|pointless|useless|what's the point|nothing works|forget it|why bother)\b/.test(
      userText,
    )
  )
    return "frustrated, needs acknowledgment";
  if (
    /\b(thank|better|helped|finally|makes sense|okay actually|that helps|i see now)\b/.test(
      userText,
    )
  )
    return "relieved, opening up";
  if (/\b(i don't know|not sure|confused|lost|overwhelmed)\b/.test(userText))
    return "uncertain, needs grounding";

  return prev?.seed.match(/WHO: (.+)/)?.[1] ?? "exploring, open";
}

function extractCarries(turns: Turn[]): string {
  const topics = turns.flatMap((t) => t.text.toLowerCase().match(/\b\w{5,}\b/g) ?? []);
  if (topics.length === 0) return "present, not heavy";

  const freq = topics.reduce(
    (acc, w) => ({ ...acc, [w]: (acc[w] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  return top ? `weight around "${top[0]}"` : "present, not heavy";
}

function detectAvoidance(turns: Turn[]): string {
  const userTurns = turns.filter((t) => t.user_initiated);
  const retreat = userTurns.find((t) =>
    /\b(never mind|forget it|doesn't matter|nvm)\b/i.test(t.text),
  );
  if (!retreat) return "nothing obvious";
  const idx = userTurns.indexOf(retreat);
  // Look at what was said JUST before they retreated
  return userTurns[idx - 1]?.text.slice(0, 40) ?? "something unnamed";
}

function detectShift(turns: Turn[], prev?: SeedData): string {
  const userTurns = turns.filter((t) => t.user_initiated);
  const hasPositive = userTurns.some((t) => /\b(better|clear|makes sense|helped)\b/i.test(t.text));
  const hadHeavy = prev?.seed.includes("frustrated") || prev?.seed.includes("heavy");
  if (hasPositive && hadHeavy) return "moved toward relief";
  if (userTurns.some((t) => /\b(worse|stuck|still)\b/i.test(t.text))) return "deepened difficulty";
  return "steady";
}

function extractThread(turns: Turn[]): string {
  const q = turns.filter((t) => t.text.includes("?"));
  return q.at(-1)?.text.slice(0, 50) ?? "none outstanding";
}

function deriveAuraState(turns: Turn[]): string {
  if (turns.some((t) => /\b(crisis|urgent|help|scared)\b/i.test(t.text))) return "high_alert";
  if (turns.some((t) => /\b(better|thanks|good)\b/i.test(t.text))) return "supportive";
  return "present";
}

function updateGrowth(turns: Turn[], prev: string[]): string[] {
  const moment = turns
    .filter((t) => t.user_initiated)
    .at(-1)
    ?.text.slice(0, 40);
  if (!moment) return prev.slice(-5);
  return [...prev, moment].slice(-5);
}
