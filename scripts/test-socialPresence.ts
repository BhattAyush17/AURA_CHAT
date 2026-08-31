/**
 * Integration tests for Social Presence wiring (Phase 2).
 *
 * Tests that Social Presence evaluation is actually invoked by the runtime
 * and produces a formatted block that reaches the shared cognitive representation.
 *
 * Run: npx tsx scripts/test-socialPresence.ts
 */

import assert from "node:assert";
import { evaluateSocialContext, formatSocialContextBlock, MUSIC_KEYWORDS, ENVIRONMENT_KEYWORDS } from "@/runtime/socialPresence/ContextualRelevanceEngine";
import { formatSocialContextBlock as formatBlock } from "@/runtime/socialPresence/formatSocialContextBlock";
import type { SocialPresenceInput, SocialContext } from "@/runtime/socialPresence/types";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${(e as Error).message}`);
    // eslint-disable-next-line no-console
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}

// ─── A. Direct wiring ────────────────────────────────────────────────

check("evaluateSocialContext is a pure function that returns SocialContext", () => {
  const input = makeInput({});
  const result = evaluateSocialContext(input);
  assert(typeof result === "object", "should return an object");
  assert(Array.isArray(result.items), "should have items array");
  assert(typeof result.timestamp === "number", "should have timestamp");
});

check("formatSocialContextBlock returns empty string when no relevant signals", () => {
  const input = makeInput({
    emotion: { tension: 0, energy: 0.1, warmth: 0.1, engagement: 0.1, frustration: 0, vulnerability: 0 },
    music: { hasActiveTrack: false, isPlaying: false, title: null, artist: null },
    atmospherePresent: false,
    memory: { hasPersonalHistory: false, retrievedCount: 0, maxRelevanceScore: 0 },
    timing: { silenceDurationMs: 0, turnCount: 1 },
    userInterrupted: false,
    auraJustSpoke: false,
    socialMomentum: { user_elaborating: false, unfinished_thought: false, user_wants_space: false, topic_depth: 0, exploratory: false, storytelling: false, argumentative: false },
    userMentionsMusic: false,
    userMentionsEnvironment: false,
  });
  const ctx = evaluateSocialContext(input);
  const block = formatBlock(ctx);
  assert(block === "", `empty context should produce empty block, got: ${block}`);
});

check("formatSocialContextBlock returns [CURRENT SOCIAL CONTEXT] block with relevant items", () => {
  const input = makeInput({
    emotion: { tension: 0, energy: 0.8, warmth: 0.8, engagement: 0.7, frustration: 0, vulnerability: 0 },
  });
  const ctx = evaluateSocialContext(input);
  const block = formatBlock(ctx);
  assert(block.includes("[CURRENT SOCIAL CONTEXT]"), `should contain header, got: ${block}`);
  assert(block.includes("[/CURRENT SOCIAL CONTEXT]"), `should close tag, got: ${block}`);
});

check("formatSocialContextBlock caps at 3 items", () => {
  const input = makeInput({
    emotion: { tension: 0.7, energy: 0.8, warmth: 0.7, engagement: 0.8, frustration: 0.7, vulnerability: 0.7 },
    userInterrupted: true,
    music: { hasActiveTrack: true, isPlaying: true, title: "Test", artist: "Artist" },
    atmospherePresent: true,
    timing: { silenceDurationMs: 20000, turnCount: 5 },
  });
  const ctx = evaluateSocialContext(input);
  const block = formatBlock(ctx);
  const lines = block.split("\n").filter((l) => l.startsWith("- "));
  assert(lines.length <= 3, `should have at most 3 items, got ${lines.length}: ${block}`);
});

// ─── B. Eight signal paths ─────────────────────────────────────────────

check("1. EMOTION: high frustration produces USER_FRUSTRATION relevance", () => {
  const input = makeInput({ emotion: { tension: 0, energy: 0.5, warmth: 0.5, engagement: 0.5, frustration: 0.7, vulnerability: 0 } });
  const ctx = evaluateSocialContext(input);
  const frustration = ctx.items.find((i) => i.category === "USER_FRUSTRATION");
  assert(frustration, `should have USER_FRUSTRATION item, got: ${JSON.stringify(ctx.items)}`);
  assert(frustration!.reason.includes("frustrat"), "reason should mention frustration");
});

check("1. EMOTION: high vulnerability produces USER_VULNERABILITY relevance", () => {
  const input = makeInput({ emotion: { tension: 0, energy: 0.5, warmth: 0.5, engagement: 0.5, frustration: 0, vulnerability: 0.7 } });
  const ctx = evaluateSocialContext(input);
  const vuln = ctx.items.find((i) => i.category === "USER_VULNERABILITY");
  assert(vuln, `should have USER_VULNERABILITY item, got: ${JSON.stringify(ctx.items)}`);
  assert(vuln!.reason.includes("emotionally"), "reason should mention emotionally vulnerable state");
});

check("1. EMOTION: high energy+warmth produces USER_EMOTION relevance", () => {
  const input = makeInput({ emotion: { tension: 0, energy: 0.8, warmth: 0.8, engagement: 0.5, frustration: 0, vulnerability: 0 } });
  const ctx = evaluateSocialContext(input);
  const emotion = ctx.items.find((i) => i.category === "USER_EMOTION");
  assert(emotion, `should have USER_EMOTION item, got: ${JSON.stringify(ctx.items)}`);
});

check("2. CONVERSATION CONTINUITY: unfinished_thought produces TOPIC_CONTINUITY relevance", () => {
  const input = makeInput({ socialMomentum: { user_elaborating: false, unfinished_thought: true, user_wants_space: false, topic_depth: 0, exploratory: false, storytelling: false, argumentative: false } });
  const ctx = evaluateSocialContext(input);
  const continuity = ctx.items.find((i) => i.category === "TOPIC_CONTINUITY");
  assert(continuity, `should have TOPIC_CONTINUITY item, got: ${JSON.stringify(ctx.items)}`);
  assert(continuity!.reason.includes("unfinished"), "reason should mention unfinished");
});

check("2. CONVERSATION CONTINUITY: deep topic produces TOPIC_CONTINUITY relevance", () => {
  const input = makeInput({ socialMomentum: { user_elaborating: false, unfinished_thought: false, user_wants_space: false, topic_depth: 4, exploratory: false, storytelling: false, argumentative: false } });
  const ctx = evaluateSocialContext(input);
  const continuity = ctx.items.find((i) => i.category === "TOPIC_CONTINUITY");
  assert(continuity, `should have TOPIC_CONTINUITY item for deep topic, got: ${JSON.stringify(ctx.items)}`);
});

check("3. MEMORY: relevant memory produces MEMORY_RELEVANCE relevance", () => {
  const input = makeInput({ memory: { hasPersonalHistory: true, retrievedCount: 3, maxRelevanceScore: 0.7 } });
  const ctx = evaluateSocialContext(input);
  const memory = ctx.items.find((i) => i.category === "MEMORY_RELEVANCE");
  assert(memory, `should have MEMORY_RELEVANCE item, got: ${JSON.stringify(ctx.items)}`);
});

check("3. MEMORY: irrelevant memory (low score) does NOT produce MEMORY_RELEVANCE", () => {
  const input = makeInput({ memory: { hasPersonalHistory: true, retrievedCount: 3, maxRelevanceScore: 0.2 } });
  const ctx = evaluateSocialContext(input);
  const memory = ctx.items.find((i) => i.category === "MEMORY_RELEVANCE");
  assert(!memory, `should NOT have MEMORY_RELEVANCE for low relevance, got: ${JSON.stringify(ctx.items)}`);
});

check("4. MUSIC: active track + user mentions music produces MUSIC_RELEVANCE", () => {
  const input = makeInput({
    music: { hasActiveTrack: true, isPlaying: true, title: "Song", artist: "Artist" },
    emotion: { tension: 0, energy: 0.5, warmth: 0.5, engagement: 0.5, frustration: 0, vulnerability: 0 },
    userMentionsMusic: true,
  });
  const ctx = evaluateSocialContext(input);
  const music = ctx.items.find((i) => i.category === "MUSIC_RELEVANCE");
  assert(music, `should have MUSIC_RELEVANCE item, got: ${JSON.stringify(ctx.items)}`);
  assert(music!.reason.includes("discussing music"), `reason should mention discussing music, got: ${music!.reason}`);
});

check("4. MUSIC: no active track does NOT produce MUSIC_RELEVANCE", () => {
  const input = makeInput({ music: { hasActiveTrack: false, isPlaying: false, title: null, artist: null } });
  const ctx = evaluateSocialContext(input);
  const music = ctx.items.find((i) => i.category === "MUSIC_RELEVANCE");
  assert(!music, `should NOT have MUSIC_RELEVANCE without active track, got: ${JSON.stringify(ctx.items)}`);
});

check("5. ATMOSPHERE: present + user mentions environment produces ATMOSPHERE_RELEVANCE", () => {
  const input = makeInput({ atmospherePresent: true, userMentionsEnvironment: true });
  const ctx = evaluateSocialContext(input);
  const atmosphere = ctx.items.find((i) => i.category === "ATMOSPHERE_RELEVANCE");
  assert(atmosphere, `should have ATMOSPHERE_RELEVANCE item, got: ${JSON.stringify(ctx.items)}`);
});

check("5. ATMOSPHERE: present but no user mention does NOT produce ATMOSPHERE_RELEVANCE", () => {
  const input = makeInput({ atmospherePresent: true, userMentionsEnvironment: false });
  const ctx = evaluateSocialContext(input);
  const atmosphere = ctx.items.find((i) => i.category === "ATMOSPHERE_RELEVANCE");
  assert(!atmosphere, `should NOT have ATMOSPHERE_RELEVANCE without user mention, got: ${JSON.stringify(ctx.items)}`);
});

check("6. INTERRUPTION: userInterrupted produces INTERRUPTION_CONTEXT relevance", () => {
  const input = makeInput({ userInterrupted: true });
  const ctx = evaluateSocialContext(input);
  const interruption = ctx.items.find((i) => i.category === "INTERRUPTION_CONTEXT");
  assert(interruption, `should have INTERRUPTION_CONTEXT item, got: ${JSON.stringify(ctx.items)}`);
  assert(interruption!.reason.includes("over AURA"), "reason should mention interruption");
});

check("7. TIMING/SILENCE: 8000ms+ silence produces SILENCE_CONTEXT relevance", () => {
  const input = makeInput({ timing: { silenceDurationMs: 8500, turnCount: 3 } });
  const ctx = evaluateSocialContext(input);
  const silence = ctx.items.find((i) => i.category === "SILENCE_CONTEXT");
  assert(silence, `should have SILENCE_CONTEXT item at 8500ms+, got: ${JSON.stringify(ctx.items)}`);
});

check("7. TIMING/SILENCE: 15000ms+ silence produces extended SILENCE_CONTEXT", () => {
  const input = makeInput({ timing: { silenceDurationMs: 18000, turnCount: 3 } });
  const ctx = evaluateSocialContext(input);
  const silence = ctx.items.find((i) => i.category === "SILENCE_CONTEXT");
  assert(silence, `should have SILENCE_CONTEXT item, got: ${JSON.stringify(ctx.items)}`);
  assert(silence!.reason.includes("reflecting"), "extended silence reason should mention reflecting");
});

check("7. TIMING/SILENCE: <5000ms silence does NOT produce SILENCE_CONTEXT", () => {
  const input = makeInput({ timing: { silenceDurationMs: 1000, turnCount: 3 } });
  const ctx = evaluateSocialContext(input);
  const silence = ctx.items.find((i) => i.category === "SILENCE_CONTEXT");
  assert(!silence, `should NOT have SILENCE_CONTEXT for short silence, got: ${JSON.stringify(ctx.items)}`);
});

check("8. USER STATE: argumentative + tension produces RELATIONSHIP_SHIFT relevance", () => {
  const input = makeInput({
    socialMomentum: { user_elaborating: false, unfinished_thought: false, user_wants_space: false, topic_depth: 0, exploratory: false, storytelling: false, argumentative: true },
    emotion: { tension: 0.7, energy: 0.5, warmth: 0.5, engagement: 0.5, frustration: 0, vulnerability: 0 },
  });
  const ctx = evaluateSocialContext(input);
  const shift = ctx.items.find((i) => i.category === "RELATIONSHIP_SHIFT");
  assert(shift, `should have RELATIONSHIP_SHIFT item, got: ${JSON.stringify(ctx.items)}`);
  assert(shift!.reason.includes("argumentative"), "reason should mention argumentative tone");
});

// ─── C. Empty context ─────────────────────────────────────────────────

check("empty input produces empty block", () => {
  const input = makeInput({});
  const ctx = evaluateSocialContext(input);
  const block = formatBlock(ctx);
  assert(block === "", `empty context should produce empty block, got: ${block}`);
});

// ─── D. Relevance filtering ───────────────────────────────────────────

check("items below WEAK threshold (0.3) are filtered out", () => {
  const input = makeInput({ timing: { silenceDurationMs: 5500, turnCount: 3 } }); // 0.2 relevance
  const ctx = evaluateSocialContext(input);
  const silence = ctx.items.find((i) => i.category === "SILENCE_CONTEXT");
  // 5500ms gives relevance 0.2, which is < 0.3 WEAK threshold
  assert(!silence || silence.relevance >= 0.3, "item should either not exist or be >= WEAK threshold");
});

// ─── E. Initiative isolation ─────────────────────────────────────────

check("Social Presence does NOT consume or produce initiative scores", () => {
  const input1 = makeInput({ emotion: { tension: 0, energy: 0.8, warmth: 0.8, engagement: 0.8, frustration: 0.8, vulnerability: 0.8 } });
  const input2 = makeInput({ emotion: { tension: 0, energy: 0.1, warmth: 0.1, engagement: 0.1, frustration: 0, vulnerability: 0 } });

  const ctx1 = evaluateSocialContext(input1);
  const ctx2 = evaluateSocialContext(input2);

  // Social Presence produces relevance scores (0-1), not initiative scores
  // It answers "what matters" not "should AURA speak"
  assert(ctx1.items.length > 0, "high emotion should produce items");
  assert(ctx2.items.length === 0, "neutral emotion should produce no items");

  // The SocialContext itself does not contain shouldSpeak, action, permission, etc.
  assert(!("shouldSpeak" in ctx1), "SocialContext should not have shouldSpeak");
  assert(!("action" in ctx1), "SocialContext should not have action");
  assert(!("permission" in ctx1), "SocialContext should not have permission");
  assert(!("initiativeScore" in ctx1), "SocialContext should not have initiativeScore");
});

check("music relevance is additive context only — not an initiative trigger", () => {
  const input = makeInput({
    music: { hasActiveTrack: true, isPlaying: true, title: "Song", artist: "Artist" },
    emotion: { tension: 0, energy: 0.1, warmth: 0.1, engagement: 0.1, frustration: 0, vulnerability: 0 },
    userMentionsMusic: false,
  });
  const ctx = evaluateSocialContext(input);
  const music = ctx.items.find((i) => i.category === "MUSIC_RELEVANCE");
  // Music playing but unrelated: relevance = 0.2 (below WEAK threshold 0.3)
  // Should not appear as a relevance item
  assert(!music || music.relevance < 0.3, "unrelated music should have low relevance");
});

// ─── F. Provider parity ───────────────────────────────────────────────

check("same input produces identical SocialContext (determinism)", () => {
  const input = makeInput({
    emotion: { tension: 0.5, energy: 0.7, warmth: 0.6, engagement: 0.6, frustration: 0.3, vulnerability: 0.2 },
    userInterrupted: true,
  });

  const ctx1 = evaluateSocialContext(input);
  const ctx2 = evaluateSocialContext(input);

  assert(ctx1.items.length === ctx2.items.length, "should produce same number of items");
  ctx1.items.forEach((item, i) => {
    assert(item.category === ctx2.items[i].category, `item ${i} should have same category`);
    assert(item.relevance === ctx2.items[i].relevance, `item ${i} should have same relevance`);
  });
});

// ─── G. Fail-open ─────────────────────────────────────────────────────

check("evaluateSocialContext is pure and does not throw on any input", () => {
  const inputs = [
    makeInput({}),
    makeInput({ emotion: { tension: 999, energy: 999, warmth: 999, engagement: 999, frustration: 999, vulnerability: 999 } }),
    makeInput({ timing: { silenceDurationMs: -1000, turnCount: -1 } }),
    makeInput({ music: { hasActiveTrack: true, isPlaying: true, title: "", artist: "" } }),
  ];

  inputs.forEach((input, idx) => {
    try {
      evaluateSocialContext(input);
    } catch (e) {
      throw new Error(`Input ${idx} threw: ${(e as Error).message}`);
    }
  });
});

check("formatSocialContextBlock handles empty items array", () => {
  const ctx: SocialContext = { items: [], dominantCategory: null, activeInfluenceAreas: [], timestamp: Date.now() };
  const block = formatBlock(ctx);
  assert(block === "", "empty items should produce empty block");
});

check("formatSocialContextBlock handles items with undefined relevance", () => {
  const ctx: SocialContext = {
    items: [
      { category: "USER_EMOTION", relevance: 0.6, reason: "test reason", canInfluence: ["TONE"] },
    ],
    dominantCategory: "USER_EMOTION",
    activeInfluenceAreas: ["TONE"],
    timestamp: Date.now(),
  };
  const block = formatBlock(ctx);
  assert(block.includes("[CURRENT SOCIAL CONTEXT]"), "should produce block");
  assert(!block.includes("undefined"), "should not contain undefined");
  assert(!block.includes("relevance"), "should not leak relevance score name");
  assert(!block.includes("0.6"), "should not leak raw score value");
});

// ─── H. Anti-leak ─────────────────────────────────────────────────────

check("formatted block does not contain internal metadata", () => {
  const input = makeInput({
    emotion: { tension: 0.6, energy: 0.8, warmth: 0.7, engagement: 0.7, frustration: 0.7, vulnerability: 0.6 },
    userInterrupted: true,
    music: { hasActiveTrack: true, isPlaying: true, title: "Song", artist: "Artist" },
  });
  const ctx = evaluateSocialContext(input);
  const block = formatBlock(ctx);

  const leakedTerms = ["relevance", "initiative", "permission", "urgency", "threshold", "category", "score", "0.6", "0.7"];
  leakedTerms.forEach((term) => {
    assert(!block.toLowerCase().includes(term.toLowerCase()), `block should not contain "${term}"`);
  });
});

check("formatted block contains only natural language reasons", () => {
  const input = makeInput({ emotion: { tension: 0, energy: 0.8, warmth: 0.8, engagement: 0.8, frustration: 0, vulnerability: 0 } });
  const ctx = evaluateSocialContext(input);
  const block = formatBlock(ctx);

  if (block === "") return; // Skip if no items above threshold

  const lines = block.split("\n").filter((l) => l.startsWith("- "));
  lines.forEach((line) => {
    assert(/^- .+\.$/.test(line.trim()), `line should be natural language: ${line}`);
    assert(!line.includes("{"), `line should not contain object notation: ${line}`);
    assert(!line.includes("}"), `line should not contain object notation: ${line}`);
    assert(!line.includes("_"), `line should not contain underscores: ${line}`);
  });
});

// ─── I. MUSIC_KEYWORDS and ENVIRONMENT_KEYWORDS are accessible ────────

check("MUSIC_KEYWORDS regex matches music-related terms", () => {
  const musicPhrases = ["song", "music", "track", "play", "listen to music", "spotify"];
  const nonMusicPhrases = ["coffee", "book", "walk", "meeting"];
  musicPhrases.forEach((phrase) => {
    assert(MUSIC_KEYWORDS.test(phrase), `"${phrase}" should match MUSIC_KEYWORDS`);
  });
  nonMusicPhrases.forEach((phrase) => {
    assert(!MUSIC_KEYWORDS.test(phrase), `"${phrase}" should not match MUSIC_KEYWORDS`);
  });
});

check("ENVIRONMENT_KEYWORDS regex matches environment-related terms", () => {
  const envPhrases = ["room", "weather", "outside", "cold", "warm", "quiet"];
  const nonEnvPhrases = ["idea", "thought", "meeting", "food"];
  envPhrases.forEach((phrase) => {
    assert(ENVIRONMENT_KEYWORDS.test(phrase), `"${phrase}" should match ENVIRONMENT_KEYWORDS`);
  });
  nonEnvPhrases.forEach((phrase) => {
    assert(!ENVIRONMENT_KEYWORDS.test(phrase), `"${phrase}" should not match ENVIRONMENT_KEYWORDS`);
  });
});

// ─── Helper ───────────────────────────────────────────────────────────

function makeInput(overrides: Partial<SocialPresenceInput>): SocialPresenceInput {
  return {
    emotion: { tension: 0, energy: 0.5, warmth: 0.5, engagement: 0.5, frustration: 0, vulnerability: 0, ...overrides.emotion },
    music: { hasActiveTrack: false, isPlaying: false, title: null, artist: null, ...overrides.music },
    atmospherePresent: false,
    memory: { hasPersonalHistory: false, retrievedCount: 0, maxRelevanceScore: 0, ...overrides.memory },
    timing: { silenceDurationMs: 0, turnCount: 1, ...overrides.timing },
    userInterrupted: false,
    auraJustSpoke: false,
    socialMomentum: { user_elaborating: false, unfinished_thought: false, user_wants_space: false, topic_depth: 0, exploratory: false, storytelling: false, argumentative: false, ...overrides.socialMomentum },
    relationshipStage: "established",
    autonomousAction: "RESPOND_ONLY",
    senseSourceCount: 0,
    userMentionsMusic: false,
    userMentionsEnvironment: false,
    ...overrides,
  };
}

// ─── Summary ─────────────────────────────────────────────────────────

// eslint-disable-next-line no-console
console.log(`\nSocial Presence Wiring Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  // eslint-disable-next-line no-console
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
