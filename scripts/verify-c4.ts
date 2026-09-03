/**
 * C4 verification — RuntimeManager getter regression.
 *
 * Audit finding (docs/reports/2026-09-02-memory-architecture-audit.md, C4):
 * OpenRouter + Sarvam call getLastAtmosphereDecision() / getLastExecutivePrompt()
 * on RuntimeManager; neither existed, so every turn threw TypeError before the
 * request was built. The two extra arguments they pass to processCognitiveTurn
 * (atmosphere, turnSignals) were also undeclared and silently discarded.
 *
 * This harness exercises the real call sequence the providers use:
 *   processCognitiveTurn(text, behavior, mode, atmosphere, turnSignals)
 *   → getLastAtmosphereDecision()?.includeAtmosphere
 *   → getLastExecutivePrompt()
 *
 * Bundle + run (import.meta.env is Vite-only, so esbuild defines it away):
 *   npx esbuild scripts/verify-c4.ts --bundle --platform=node --format=esm \
 *     --alias:@=./src --define:import.meta.env='{}' --outfile=/tmp/verify-c4.mjs
 *   node /tmp/verify-c4.mjs
 */

import type { BehaviorAnalysis } from "../src/lib/behavior-client";

// ─── Browser shims ──────────────────────────────────────────────────
// The runtime graph touches localStorage (user identity, reflection weights).
// Imports are hoisted, so the modules under test are pulled in dynamically
// inside main() — after these shims exist.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const behavior: BehaviorAnalysis = {
  act: "Sharing something personal",
  tags: [],
  template: null,
  source: "test",
  energy: 0.4,
  behavior_instructions: "",
  emotional_state: "Vulnerable",
  intensity: 0.6,
  frustration: 0.1,
  playfulness: 0.2,
  vulnerability: 0.8,
  trust: 0.7,
  anxiety: 0.3,
  status: "ok",
};

async function main() {
  const { RuntimeManager } = await import("../src/runtime/RuntimeManager");
  const { browserTemporalAtmosphere } = await import("../src/executive/AtmosphereContext");

  const rm = RuntimeManager.getInstance();

  // ── 1. The getters must exist as functions (this is the C4 TypeError) ──
  assert(
    "getLastAtmosphereDecision is a function",
    typeof rm.getLastAtmosphereDecision === "function",
  );
  assert("getLastExecutivePrompt is a function", typeof rm.getLastExecutivePrompt === "function");

  // ── 2. Pre-turn defaults must be safe for the `?.` / `??` call sites ──
  assert("pre-turn atmosphere decision is null", rm.getLastAtmosphereDecision() === null);
  assert(
    "pre-turn includeAtmosphere read does not throw",
    (rm.getLastAtmosphereDecision()?.includeAtmosphere ?? false) === false,
  );
  assert("pre-turn executive prompt is empty string", rm.getLastExecutivePrompt() === "");

  // ── 3. The exact provider call: 5 args, atmosphere-relevant text ──
  const atmosphere = browserTemporalAtmosphere();
  const relevant = await rm.processCognitiveTurn(
    "what time is it right now?",
    behavior,
    "adaptive",
    atmosphere,
    { wasInterruption: true, silenceDurationMs: 4200 },
  );

  assert("cognitive block returned", typeof relevant === "string" && relevant.length > 0);

  const decision = rm.getLastAtmosphereDecision();
  assert("post-turn atmosphere decision populated", decision !== null);
  assert(
    "temporal question opens the atmosphere slot",
    decision?.includeAtmosphere === true,
    `includeAtmosphere=${decision?.includeAtmosphere} rationale=${decision?.rationale.join("; ")}`,
  );

  const prompt = rm.getLastExecutivePrompt();
  assert(
    "executive prompt is the [EXECUTIVE PLAN] directive",
    prompt.startsWith("[EXECUTIVE PLAN]"),
    `got: ${JSON.stringify(prompt.slice(0, 60))}`,
  );
  assert("executive prompt names a strategy", /strategy: \w+/.test(prompt));

  // ── 4. atmosphere must actually reach the rendered block ──
  // buildAtmosphereContextBlock emits [ENVIRONMENT CONTEXT] (AtmosphereContext.ts:200).
  assert(
    "environment block rendered for a relevant turn",
    relevant.includes("[ENVIRONMENT CONTEXT]"),
    `block absent; length=${relevant.length}`,
  );
  assert(
    "rendered block carries the wall-clock grounding",
    /\[ENVIRONMENT CONTEXT\][\s\S]*Time: /.test(relevant),
    "temporal dimension marked relevant but no Time line rendered",
  );

  // ── 5. An unrelated turn must suppress atmosphere (no blanket injection) ──
  const unrelated = await rm.processCognitiveTurn(
    "explain how a hash map works",
    behavior,
    "adaptive",
    atmosphere,
    { wasInterruption: false },
  );
  const irrelevant = rm.getLastAtmosphereDecision();
  assert(
    "unrelated turn suppresses atmosphere",
    irrelevant?.includeAtmosphere === false,
    `includeAtmosphere=${irrelevant?.includeAtmosphere} rationale=${irrelevant?.rationale.join("; ")}`,
  );
  assert(
    "no environment block on a suppressed turn",
    !unrelated.includes("[ENVIRONMENT CONTEXT]"),
    "environment block leaked into an unrelated turn",
  );

  // ── 6. Gemini's 3-arg snapshot call must also be accepted ──
  const snapshot = await rm.buildInitialCognitiveSnapshot("test-user", "adaptive", atmosphere);
  assert("initial snapshot built with atmosphere arg", typeof snapshot === "string");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
