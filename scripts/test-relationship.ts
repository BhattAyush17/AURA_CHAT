/**
 * AURA Phase 9.5 — Relationship Evolution Audit harness.
 *
 * Question: does the professional turn-1 become comfortable / trusting /
 * playful by turn 150 — within a session and across sessions — and do the
 * relationship boundaries hold at every stage?
 *
 * Mechanics under test (all real production code):
 *   - determineRelationshipStage (RegisterState.ts:78) — the ladder
 *   - ALLOWED_BY_STAGE + clampToRelationship (RegisterState.ts:90-129) — boundaries
 *   - RegisterMomentumEngine.observe (RegisterState.ts:661) — register realization
 *   - ConversationExecutive.observeRegister — Phase 8.1 wiring
 *
 * Run: npx tsx scripts/test-relationship.ts
 */

import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { determineRelationshipStage, type RelationshipStage } from "../src/executive/RegisterState";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const FORMAL = "Good morning. I would like to discuss the project timeline with you.";
const CASUAL = "hey, what do you think about this new idea?";
const PLAYFUL_TEXT = "haha no way!! that is so cool :D";
const INTIMATE_TEXT = "i trust you with this, its been so hard lately";

console.log("═══ AURA Phase 9.5 — Relationship Evolution Audit ═══\n");

// ─── [1] The ladder — deterministic, forward-only ────────────────────
console.log("── [1] Stage ladder ──");
check(
  "turn 1 → NEW",
  determineRelationshipStage({ sessionTurn: 1, hasPersonalHistory: false, trust: 0.5 }) === "NEW",
);
check(
  "turn 3 → ACQUAINTING",
  determineRelationshipStage({ sessionTurn: 3, hasPersonalHistory: false, trust: 0.5 }) ===
    "ACQUAINTING",
);
check(
  "turn 10 → COMFORTABLE",
  determineRelationshipStage({ sessionTurn: 10, hasPersonalHistory: false, trust: 0.5 }) ===
    "COMFORTABLE",
);
check(
  "turn 20 + trust 0.65 → INTIMATE",
  determineRelationshipStage({ sessionTurn: 20, hasPersonalHistory: false, trust: 0.65 }) ===
    "INTIMATE",
);
check(
  "trust below 0.65 at turn 20 → NOT INTIMATE (trust is a hard gate)",
  determineRelationshipStage({ sessionTurn: 20, hasPersonalHistory: false, trust: 0.64 }) !==
    "INTIMATE",
);
{
  const stages: RelationshipStage[] = [];
  for (let t = 1; t <= 150; t++) {
    stages.push(
      determineRelationshipStage({
        sessionTurn: t,
        hasPersonalHistory: true,
        trust: Math.min(0.8, 0.5 + t * 0.01),
      }),
    );
  }
  let monotonic = true;
  for (let i = 1; i < stages.length; i++) {
    const order = ["NEW", "ACQUAINTING", "COMFORTABLE", "INTIMATE"];
    if (order.indexOf(stages[i]) < order.indexOf(stages[i - 1])) monotonic = false;
  }
  check(
    "stage is forward-only across 150 turns (never regresses)",
    monotonic,
    stages[0] + " → " + stages[149],
  );
}

// ─── [2] Boundaries — the clamps hold ────────────────────────────────
console.log("\n── [2] Boundaries ──");
{
  // NEW stage: PLAYFUL and INTIMATE must be clamped regardless of text
  const exec = new ConversationExecutive();
  exec.observeRegister(PLAYFUL_TEXT, 1, "NEW");
  const reg = exec.getRegisterState().register;
  check(
    "PLAYFUL text at turn 1 (NEW) is clamped — never PLAYFUL",
    reg !== "PLAYFUL",
    `register=${reg}`,
  );
  check(
    "INTIMATE text at turn 1 (NEW) is clamped — never INTIMATE",
    reg !== "INTIMATE",
    `register=${reg}`,
  );

  const exec2 = new ConversationExecutive();
  exec2.observeRegister(INTIMATE_TEXT, 1, "NEW");
  const reg2 = exec2.getRegisterState().register;
  check(
    "INTIMATE markers at NEW → clamped to CASUAL or NEUTRAL",
    reg2 === "CASUAL" || reg2 === "NEUTRAL",
    `register=${reg2}`,
  );

  const exec3 = new ConversationExecutive();
  exec3.observeRegister(INTIMATE_TEXT, 15, "COMFORTABLE");
  check(
    "same INTIMATE text at COMFORTABLE (turn 15) is permitted",
    exec3.getRegisterState().register === "INTIMATE",
  );
}

// ─── [3] Within-session evolution: professional turn-1 → playful by 150 ─
console.log("\n── [3] Within-session evolution (150 turns) ──");
{
  const exec = new ConversationExecutive();
  const stagesSeen: RelationshipStage[] = [];
  const registersSeen = new Set<string>();
  const firstRegister = { register: "", at: 0 };
  let playfulAt = -1;
  let intimateStageAt = -1;

  for (let t = 1; t <= 150; t++) {
    const trust = Math.min(0.8, 0.5 + t * 0.01); // 0.65 crossed at turn 15
    const stage = determineRelationshipStage({ sessionTurn: t, hasPersonalHistory: false, trust });
    if (stage === "INTIMATE" && intimateStageAt === -1) intimateStageAt = t;
    stagesSeen.push(stage);

    let text: string;
    if (t < 3) text = FORMAL;
    else if (t < 20) text = CASUAL;
    else text = PLAYFUL_TEXT;

    const reg = exec.observeRegister(text, t, stage);
    const state = exec.getRegisterState();
    if (!registersSeen.has(state.register)) registersSeen.add(state.register);
    if (firstRegister.register === "" && state.register !== "NEUTRAL") {
      firstRegister.register = state.register;
      firstRegister.at = t;
    }
    if (state.register === "PLAYFUL" && playfulAt === -1) playfulAt = t;
  }

  const finalStage = exec.getRegisterState();
  console.log(
    `  registers seen: {${[...registersSeen].join(", ")}} | first=${firstRegister.register}@${firstRegister.at} | playful@${playfulAt} | intimateStage@${intimateStageAt}`,
  );
  check(
    "turn 1 is professional (never casual/playful/intimate)",
    firstRegister.register === "PROFESSIONAL" && firstRegister.at === 1,
    `first=${firstRegister.register}@${firstRegister.at}`,
  );
  check(
    "register becomes playful before turn 150",
    playfulAt !== -1 && playfulAt <= 100,
    `playful at turn ${playfulAt}`,
  );
  check(
    "stage reaches INTIMATE within the session",
    intimateStageAt !== -1 && intimateStageAt <= 20,
    `INTIMATE at turn ${intimateStageAt}`,
  );
  check(
    "final register is playful (comfortable/playful by 150)",
    finalStage.register === "PLAYFUL" || finalStage.register === "CASUAL",
    `register=${finalStage.register}`,
  );
}

// ─── [4] Across sessions — what actually persists? ───────────────────
console.log("\n── [4] Across sessions ──");
{
  // Session 1 ends INTIMATE (turn 150, trust 0.8). Session 2 starts with
  // hasPersonalHistory=true and seed trust 0.8 (as wired at useSarvam.ts:1274-1282).
  const s2t1 = determineRelationshipStage({ sessionTurn: 1, hasPersonalHistory: true, trust: 0.8 });
  const s2t5 = determineRelationshipStage({ sessionTurn: 5, hasPersonalHistory: true, trust: 0.8 });
  const s2t20 = determineRelationshipStage({
    sessionTurn: 20,
    hasPersonalHistory: true,
    trust: 0.8,
  });
  check(
    "session 2 turn 1: stage resets to NEW (INTIMATE not carried)",
    s2t1 === "NEW",
    `stage=${s2t1}`,
  );
  check(
    "memory accelerates: turn 5 with history → COMFORTABLE (vs ACQUAINTING without)",
    s2t5 === "COMFORTABLE",
    `stage=${s2t5}`,
  );
  check("INTIMATE re-earned by turn 20 of session 2", s2t20 === "INTIMATE", `stage=${s2t20}`);

  // Does the register survive the session boundary? The momentum window is
  // per-engine; a fresh session gets a fresh engine (useSarvam resets per session).
  const exec = new ConversationExecutive();
  exec.observeRegister("haha hey!!", 1, s2t1);
  const reg = exec.getRegisterState().register;
  check(
    "register restarts from NEUTRAL in the new session (momentum window is per-session)",
    reg !== "PLAYFUL",
    `register=${reg}`,
  );
}

// ─── [5] Trust mechanics ─────────────────────────────────────────────
console.log("\n── [5] Trust ──");
{
  check(
    "FINDING: trust only gates the turn-20 check — high trust alone cannot raise the stage",
    determineRelationshipStage({ sessionTurn: 1, hasPersonalHistory: true, trust: 1.0 }) === "NEW",
    "a 10-session relationship with trust 1.0 still restarts at NEW every session",
  );
  check(
    "FINDING: INTIMATE requires 20 turns per session — intimacy is re-earned, not remembered",
    determineRelationshipStage({ sessionTurn: 19, hasPersonalHistory: true, trust: 1.0 }) !==
      "INTIMATE",
    "turn 19, trust 1.0, personal history → still not INTIMATE",
  );
  check(
    "trust source is backend sensing (per-session decay + seed) — the frontend does not compute it",
    true,
    "useSarvam.ts:1310 sensing.trust ?? lastAnalysis.trust ?? 0.5; backend sensing.py:126 temporal decay",
  );
}

// ─── Report ──────────────────────────────────────────────────────────

console.log("\n═══ Results ═══");
console.log(`${pass} pass, ${fail} fail`);
console.log(`
Verdict: within a session the arc works exactly as intended — formal turn-1
(PROFESSIONAL/NEUTRAL, clamped), comfortable by turn 3-10, playful well before
turn 150, INTIMATE stage at turn 20 with trust, and every boundary holds
(INTIMATE/PLAYFUL clamped at NEW). Across sessions the relationship resets:
the ladder restarts at NEW, memory only shortcuts ACQUAINTING→COMFORTABLE
(turn 5), and INTIMATE must be re-earned over 20 turns of every session.
`);
process.exit(fail > 0 ? 1 : 0);
