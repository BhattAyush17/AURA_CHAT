import {
  createDefaultSeed,
  calculateTrust,
  validateSeed,
  enforceSizeCeiling,
  buildSeedInjection,
  compressTranscript,
  auraSeedToLegacy,
  legacyToAuraSeed,
  buildCrystallizationPrompt,
  parseCrystallizationOutput,
} from "../src/lib/aura-memory";
import type { AuraSeed } from "../src/lib/aura-memory";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.error(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("==========================================");
console.log("🧠 AURA REFLECTIVE MEMORY SYSTEM TESTS");
console.log("==========================================\n");

// ── 1. Default Seed ──────────────────────────────────────────────
const seed = createDefaultSeed("test-user-hash", "hinglish");
assert("Default seed: has uid", seed.uid === "test-user-hash");
assert("Default seed: trust starts at 0.3", seed.core.trust === 0.3);
assert("Default seed: lang is hinglish", seed.core.lang === "hinglish");
assert("Default seed: arc is empty", seed.arc.length === 0);
assert("Default seed: thread is set", seed.thread.length > 0);

const defaultSize = new TextEncoder().encode(JSON.stringify(seed)).length;
assert(`Default seed: under 2KB (${defaultSize}B)`, defaultSize <= 2048);

// ── 2. Trust Calculation ─────────────────────────────────────────
const t1 = calculateTrust(0.5, 0.9); // good session
assert("Trust: good session increases trust", t1 > 0.5);

const t2 = calculateTrust(0.5, 0.1); // bad session
assert("Trust: bad session decreases trust", t2 < 0.5);

const t3 = calculateTrust(0.5, 0.5, 4); // 4 weeks absent
assert("Trust: absence decays trust", t3 < 0.5);

const t4 = calculateTrust(0.05, 0.0); // extreme low
assert("Trust: floor at 0.1", t4 >= 0.1);

const t5 = calculateTrust(0.95, 1.0); // extreme high
assert("Trust: ceiling at 1.0", t5 <= 1.0);

// ── 3. Seed Validation ──────────────────────────────────────────
const validSeed = createDefaultSeed("u1");
assert("Validation: default seed has no errors", validateSeed(validSeed).length === 0);

const overSeed: AuraSeed = {
  ...createDefaultSeed("u2"),
  arc: Array(6).fill([0, "x".repeat(90), "+"]), // 6 entries, each too long
  growth: ["a", "b", "c", "d"], // 4 entries
  thread: "x".repeat(150), // too long
};
const errors = validateSeed(overSeed);
assert(
  "Validation: catches arc overflow",
  errors.some((e) => e.includes("arc exceeds")),
);
assert(
  "Validation: catches growth overflow",
  errors.some((e) => e.includes("growth exceeds")),
);
assert(
  "Validation: catches thread overflow",
  errors.some((e) => e.includes("thread exceeds")),
);

// ── 4. 2KB Enforcement ──────────────────────────────────────────
const fatSeed: AuraSeed = {
  ...createDefaultSeed("u3"),
  arc: Array(5).fill([0, "x".repeat(80), "+"]),
  growth: ["g".repeat(60), "g".repeat(60), "g".repeat(60)],
  tensions: ["t".repeat(60), "t".repeat(60)],
  thread: "t".repeat(120),
};
const enforced = enforceSizeCeiling(fatSeed);
const enforcedSize = new TextEncoder().encode(JSON.stringify(enforced)).length;
assert(`2KB enforcement: enforced seed is ${enforcedSize}B, under 2048`, enforcedSize <= 2048);

// ── 5. Seed Injection ───────────────────────────────────────────
const newUserInjection = buildSeedInjection(null);
assert("Injection: new user gets curiosity prompt", newUserInjection.includes("NEW USER"));

const richSeed: AuraSeed = {
  ...createDefaultSeed("u4"),
  core: { lang: "hi", trust: 0.72, tone_pref: "philosophical" },
  arc: [[3, "grief about father reframed as gratitude", "*"]],
  thread: "Still learning to want things for himself, slowly starting to ask.",
  tensions: ["career uncertainty deepening"],
  growth: ["reframed failure as iteration"],
  resonance: { receives_best: "silence", metaphor_style: "nature", avoid: ["platitudes"] },
};
const injection = buildSeedInjection(richSeed);
assert("Injection: includes trust level", injection.includes("trust:0.72"));
assert("Injection: includes thread", injection.includes("Still learning"));
assert("Injection: includes arc entry", injection.includes("grief about father"));
assert("Injection: includes tension", injection.includes("career uncertainty"));
assert(
  "Injection: ends with silent-read directive",
  injection.includes("Let it inform, not perform"),
);

// ── 6. Transcript Compression ───────────────────────────────────
const transcript = [
  { text: "I've been thinking about my father a lot.", user_initiated: true },
  { text: "What comes up when you think of him?", user_initiated: false },
  { text: "Mostly regret. But also gratitude for small things.", user_initiated: true },
  { text: "", user_initiated: true }, // empty, should be filtered
];
const compressed = compressTranscript(transcript);
assert("Compression: filters empty turns", !compressed.includes("U: \n"));
assert("Compression: has 3 valid lines", compressed.split("\n").length === 3);
assert("Compression: labels user turns U:", compressed.includes("U: I've been"));
assert("Compression: labels AURA turns A:", compressed.includes("A: What comes"));

// ── 7. Bridge: AuraSeed → Legacy SeedData ───────────────────────
const legacy = auraSeedToLegacy(richSeed);
assert("Bridge→Legacy: has version", legacy.version === 1);
assert("Bridge→Legacy: seed contains thread", legacy.seed.includes("Still learning"));
assert("Bridge→Legacy: growth carried over", legacy.growth.length === 1);

// ── 8. Bridge: Legacy SeedData → AuraSeed ───────────────────────
const recovered = legacyToAuraSeed(legacy, "u4");
assert("Bridge→AuraSeed: trust recovered", recovered.core.trust === 0.72);
assert("Bridge→AuraSeed: lang recovered", recovered.core.lang === "hi");
assert("Bridge→AuraSeed: thread recovered", recovered.thread.includes("Still learning"));

// ── 9. Crystallization Prompt ───────────────────────────────────
const crystalPrompt = buildCrystallizationPrompt(richSeed, transcript);
assert("Crystal prompt: contains previous seed JSON", crystalPrompt.includes('"uid":"u4"'));
assert("Crystal prompt: contains compressed transcript", crystalPrompt.includes("U: I've been"));
assert("Crystal prompt: has 2KB rule", crystalPrompt.includes("2048 bytes"));

// ── 10. Parse Crystallization Output ────────────────────────────
const mockOutput = JSON.stringify({
  v: 1,
  uid: "u4",
  updated: Math.floor(Date.now() / 1000),
  core: { lang: "hi", trust: 0.75, tone_pref: "philosophical" },
  arc: [[0, "gratitude surfaced through grief work", "*"]],
  growth: ["reframed failure as iteration"],
  tensions: [],
  resonance: { receives_best: "silence", avoid: [] },
  thread: "Grief is becoming a teacher, not a weight.",
});
const parsed = parseCrystallizationOutput(mockOutput, "u4");
assert("Parse: returns valid AuraSeed", parsed !== null);
assert("Parse: trust preserved", parsed?.core.trust === 0.75);
assert("Parse: thread preserved", parsed?.thread === "Grief is becoming a teacher, not a weight.");

const parsedSize = new TextEncoder().encode(JSON.stringify(parsed)).length;
assert(`Parse: output under 2KB (${parsedSize}B)`, parsedSize <= 2048);

// Bad output
const badParsed = parseCrystallizationOutput("not json at all", "u4");
assert("Parse: gracefully returns null on garbage", badParsed === null);

// ── Summary ─────────────────────────────────────────────────────
console.log(`\n==========================================`);
console.log(`Results: ${passed}/${passed + failed} passed.`);
if (failed > 0) console.log(`⚠️  ${failed} test(s) failed.`);
console.log(`==========================================`);
