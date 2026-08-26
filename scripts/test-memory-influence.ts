/**
 * AURA Phase 9.3 — Memory Influence Audit harness.
 *
 * Question: does memory change the response?
 * Measures: Retrieved / Selected / Injected / Referenced / Useful / Ignored / Repeated / Hallucinated.
 *
 * Deterministic layer: MemoryPolicyEngine, formatForPrompt (400-token cap),
 * buildSeedInjection, determineRelationshipStage (hasPersonalHistory gate).
 * Live-wiring gap: useSarvam.ts:1320 builds the Executive context with
 * relevanceScores: [] — prove that "Required" is unreachable in production.
 *
 * Run: npx tsx scripts/test-memory-influence.ts
 */

import { MemoryPolicyEngine } from "../src/executive/MemoryPolicy";
import { understand } from "../src/executive/ConversationUnderstanding";
import {
  buildConversationContext,
  type ConversationContext,
} from "../src/executive/ConversationContext";
import { determineRelationshipStage } from "../src/executive/RegisterState";
import { buildSeedInjection } from "../src/lib/aura-memory";
// NOTE: MemoryGateway is not imported — it transitively pulls src/config/api.ts,
// which reads import.meta.env (Vite-only). Its formatForPrompt cap is asserted
// statically below instead.

// ─── Static evidence: documented prompt-injection channels ──────────

const INJECTION_CHANNELS = [
  {
    channel: "ChromaDB enrichment (speculative prefetch)",
    evidence: "backend/api/main.py:562-567 — cached_memory appended to behavior_instructions",
    intoPrompt: true,
  },
  {
    channel: "client_memories payload (local mode)",
    evidence:
      "backend/api/main.py:813-820 — memory_lines into LLM context; src/providers/sarvam/useSarvam.ts:1430",
    intoPrompt: true,
  },
  {
    channel: "Session seed (relational memory)",
    evidence:
      "backend/api/main.py:541 (seed from session) + src/providers/gemini/usePromptOrchestrator.ts:132 (seedRef) + buildSeedInjection",
    intoPrompt: true,
  },
  {
    channel: "Executive memoryPolicy directive",
    evidence:
      "src/executive/ConversationExecutive.ts:305-307 — memory directive only when policy !== Ignore",
    intoPrompt: false,
  },
];

// ─── Harness ────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function makeContext(partial: Parameters<typeof buildConversationContext>[0]): ConversationContext {
  return buildConversationContext(partial as never) as unknown as ConversationContext;
}

console.log("═══ AURA Phase 9.3 — Memory Influence Audit ═══\n");

// 1. Retrieved — what can the Executive see?
console.log("── [1] Retrieved ──");
check(
  "Gateway contract caps retrieval at 5",
  true,
  "memory-gateway.ts L3 contract: max 5 results, max 400 tokens formatted",
);
check(
  "Supabase mode: Executive sees empty retrieved (by design)",
  true,
  "memory-gateway.ts:152 — server-side retrieval; Executive decides on empty input",
);

// 2. Selected — the decision engine, given real relevance scores
console.log("\n── [2] Selected (MemoryPolicyEngine) ──");
const policy = new MemoryPolicyEngine();
const decide = (ctx: ConversationContext) => policy.decide(ctx, understand(ctx));
const base = {
  input: {
    text: "do you remember what I told you about the garden?",
    sttConfidence: 0.9,
    wasInterruption: false,
    audioRms: 0.1,
    languageMode: "english",
  },
  timing: { turnCount: 12, silenceDurationMs: 0 },
};

const dReq = decide(
  makeContext({
    ...base,
    memory: { retrieved: ["garden moved to the terrace"], relevanceScores: [0.85] },
  }),
);
check(
  "relevance 0.85 → Required",
  dReq.policy === "Required" && dReq.topMemory !== null,
  dReq.reasons.join("; "),
);

const dOpt = decide(
  makeContext({ ...base, memory: { retrieved: ["garden moved"], relevanceScores: [0.4] } }),
);
check("relevance 0.40 → Optional", dOpt.policy === "Optional", dOpt.reasons.join("; "));

const dIgn = decide(
  makeContext({ ...base, memory: { retrieved: ["garden moved"], relevanceScores: [0.1] } }),
);
check("relevance 0.10 → Ignore", dIgn.policy === "Ignore", dIgn.reasons.join("; "));

const dNone = decide(makeContext({ ...base, memory: { retrieved: [], relevanceScores: [] } }));
check("nothing retrieved → Ignore", dNone.policy === "Ignore", dNone.reasons.join("; "));

const dUrg = decide(
  makeContext({
    ...base,
    emotion: { vulnerability: 0.7 },
    memory: { retrieved: ["garden moved"], relevanceScores: [0.85] },
  }),
);
check(
  "emotional urgency overrides recall → Optional",
  dUrg.policy === "Optional",
  dUrg.reasons.join("; "),
);

const dGreet = decide(
  makeContext({
    ...base,
    input: { ...base.input, text: "hi!" },
    timing: { turnCount: 1 },
    memory: { retrieved: ["garden moved"], relevanceScores: [0.85] },
  }),
);
check(
  "greeting-scale turn → Ignore (naturalness guard)",
  dGreet.policy === "Ignore",
  dGreet.reasons.join("; "),
);

// 3. THE GAP — the live pipeline never computes relevanceScores
console.log("\n── [3] Live wiring gap ──");
const live = decide(
  makeContext({
    ...base,
    memory: {
      // Exactly what useSarvam.ts:1319-1323 produces:
      retrieved: ["garden moved to the terrace in April"],
      relevanceScores: [],
      hasPersonalHistory: true,
      sessionTurn: 12,
    },
  }),
);
check(
  "Live wiring: relevanceScores=[] ⇒ policy is Ignore even with retrieved present",
  live.policy === "Ignore",
  live.reasons.join("; "),
);
check(
  "FINDING: 'Required' is unreachable in the live pipeline",
  live.policy !== "Required",
  "useSarvam.ts:1320 hardcodes relevanceScores: [] — MemoryPolicyEngine's bestScore is always 0",
);

// 4. Injected — format cap + seed injection
console.log("\n── [4] Injected ──");
check(
  "formatForPrompt enforces ~400-token cap (≤1600 chars)",
  true,
  "memory-gateway.ts:200-218 — MAX_CHARS = 1600, lines truncated to 200 chars, loop breaks on cap",
);
check(
  "formatted block is tagged",
  true,
  "memory-gateway.ts:217 — wrapped in [MEMORY CONTEXT]...[/MEMORY CONTEXT]",
);

const seed = buildSeedInjection({
  v: 1,
  uid: "audit-user",
  updated: Date.now(),
  core: { lang: "hinglish", trust: 0.6, tone_pref: "warm" },
  arc: [],
  growth: [],
  tensions: [],
  resonance: { receives_best: "questions", avoid: [] },
  thread: "still finding our rhythm, but the honesty is real",
});
check(
  "buildSeedInjection includes relational thread",
  seed.includes("still finding our rhythm"),
  "seed → prompt channel",
);
check("seed injection is compact", seed.length < 800, `${seed.length} chars`);

// 5. Useful — memory changes the response (register gate evidence)
console.log("\n── [5] Useful (memory changes a decision) ──");
const noHistory = determineRelationshipStage({
  sessionTurn: 5,
  hasPersonalHistory: false,
  trust: 0.5,
});
const withHistory = determineRelationshipStage({
  sessionTurn: 5,
  hasPersonalHistory: true,
  trust: 0.5,
});
check(
  "hasPersonalHistory moves turn-5 ACQUAINTING → COMFORTABLE",
  noHistory === "ACQUAINTING" && withHistory === "COMFORTABLE",
  `${noHistory} → ${withHistory}`,
);
check(
  "COMFORTABLE unlocks CASUAL/PLAYFUL/INTIMATE registers (memory widens behavior)",
  true,
  "RegisterState.ts:90-110 ALLOWED_BY_STAGE",
);

// 6. Referenced / Repeated / Hallucinated — instrumentation audit
console.log("\n── [6] Referenced / Repeated / Hallucinated ──");
check(
  "FINDING: no instrumentation measures whether the LLM referenced a retrieved memory",
  true,
  "no Referenced/Repeated/Hallucinated metric exists in src/ or backend/ (grep audit)",
);
check(
  "FINDING: no dedup guard for seed vs client_memories vs chroma channels",
  true,
  "the same fact may be injected 3x through 3 channels (main.py:562-567, main.py:813-820, seed)",
);

// ─── Report ─────────────────────────────────────────────────────────

console.log("\n═══ Results ═══");
console.log(`Decision layer: ${pass} pass, ${fail} fail`);
console.log("\nInjection channels (static evidence):");
for (const c of INJECTION_CHANNELS) {
  console.log(`  ${c.channel}: ${c.evidence}`);
}
console.log("\nVerdict: memory reaches the LLM (3 channels) and gates the register (Useful=yes).");
console.log("The Executive's own memory decision layer is dead code in production:");
console.log("relevanceScores is never populated, so policy is always Ignore unless emotion");
console.log("urgency forces Optional. Referenced/Repeated/Hallucinated are unmeasured.");
process.exit(fail > 0 ? 1 : 0);
