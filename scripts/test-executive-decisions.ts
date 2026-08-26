/**
 * Phase 9.1 — Executive Decision Audit.
 *
 * Not "is the Executive running?" but "is the Executive making the
 * correct decisions — every turn?"
 *
 * Two measurement classes:
 *   1. GATE CORRECTNESS — does the Executive behave per its own
 *      deterministic spec (greeting→Answer, backchannel→Observe,
 *      hedged→Clarify, frustration→Answer, long-silence→Ask …)?
 *   2. HUMAN BENCHMARK — does the Executive match what a human
 *      conversationalist would decide (repair turns, rejections,
 *      ambiguity)? These are measured and reported, not asserted,
 *      because a failed benchmark IS the audit finding.
 *
 * Per scenario: Decision, Confidence, Reasoning (rationale),
 * Alternative Decisions (ranked strategy ladder), Human Comparison.
 *
 * Run: npx tsx scripts/test-executive-decisions.ts
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import { StrategyPlanner } from "../src/executive/StrategyPlanner";
import { understand } from "../src/executive/ConversationUnderstanding";
import type { ConversationContext } from "../src/executive/ConversationContext";
import type { Initiative, Strategy } from "../src/executive/ExecutionPlan";

let gateFailures = 0;
let benchmarkMisses = 0;
let benchmarkTotal = 0;
const assert = (cond: boolean, label: string) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) gateFailures++;
};

interface Scenario {
  name: string;
  text: string;
  ctx?: Partial<ConversationContext>;
  /** Acceptable strategies (several correct answers exist). */
  strategies: Strategy[];
  /** Acceptable initiatives. */
  initiatives: Initiative[];
  /** Acceptable clarification outcomes. */
  clarification?: boolean[];
  /** Acceptable confidence labels. */
  confidence?: string[];
  /** Whether this is a human-benchmark scenario (measured, not gated). */
  benchmark?: boolean;
  /** The human's read of the room — the audit narrative. */
  humanRead: string;
}

const exec = new ConversationExecutive();
const planner = new StrategyPlanner();

function decide(sc: Scenario) {
  const ctx = buildConversationContext({
    input: {
      text: sc.text,
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "detected",
      ...sc.ctx?.input,
    },
    language: exec.getLanguageState(),
    register: exec.getRegisterState(),
    emotion: {
      dominant: "neutral",
      tension: 0.1,
      trust: 0.5,
      energy: 0.5,
      warmth: 0.5,
      engagement: 0.5,
      frustration: 0,
      vulnerability: 0.3,
      arc: "building",
      ...sc.ctx?.emotion,
    },
    memory: { ...sc.ctx?.memory },
    identity: { ...sc.ctx?.identity },
    timing: {
      silenceDurationMs: 0,
      turnCount: 5,
      lastResponseLatencyMs: 0,
      averageResponseLengthWords: 30,
      ...sc.ctx?.timing,
    },
    behaviorAnalysis: sc.ctx?.behaviorAnalysis ?? null,
  });
  const plan = exec.plan(ctx);
  const ladder = planner.plan(ctx, understand(ctx));
  const alternatives = Object.entries(ladder.scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, score]) => `${s}(${score})`)
    .join(" ");
  return { ctx, plan, alternatives, ladder };
}

function run(sc: Scenario) {
  const { plan, alternatives, ladder } = decide(sc);
  const strategyOk = sc.strategies.includes(plan.strategy.primary);
  const initiativeOk = sc.initiatives.includes(plan.initiative);
  const clarificationOk = sc.clarification
    ? sc.clarification.includes(plan.clarification.required)
    : true;
  const confidenceOk = sc.confidence ? sc.confidence.includes(plan.confidence.label) : true;
  const match = strategyOk && initiativeOk && clarificationOk && confidenceOk;

  if (sc.benchmark) {
    benchmarkTotal++;
    if (!match) benchmarkMisses++;
  } else if (!match) {
    gateFailures++;
  }

  console.log(`\n── ${sc.name}${sc.benchmark ? "  [HUMAN BENCHMARK]" : ""} ──`);
  console.log(`  user:   "${sc.text}"`);
  console.log(
    `  plan:   strategy=${plan.strategy.primary}${plan.strategy.secondary ? `→${plan.strategy.secondary}` : ""}` +
      ` | initiative=${plan.initiative} | clarify=${plan.clarification.required}` +
      ` | confidence=${plan.confidence.label}(${plan.confidence.value.toFixed(2)})` +
      ` | budget=${plan.informationBudget}`,
  );
  console.log(`  rationale: ${plan.rationale.join(" | ")}`);
  console.log(`  alternatives: ${alternatives}`);
  console.log(`  human:  ${sc.humanRead}`);
  console.log(
    match
      ? "  verdict: ✅ MATCH"
      : `  verdict: ❌ MISMATCH (expected strategy∈[${sc.strategies.join(",")}] initiative∈[${sc.initiatives.join(",")}]${sc.clarification ? ` clarify∈[${sc.clarification.join(",")}]` : ""}${sc.confidence ? ` confidence∈[${sc.confidence.join(",")}]` : ""})`,
  );
  if (ladder.primary !== plan.strategy.primary) {
    console.log("  ⚠️  plan.strategy diverges from StrategyPlanner — inconsistent");
  }
}

// ─── GATE CORRECTNESS (the Executive does what its spec says) ────────

run({
  name: "Greeting",
  text: "Hello!",
  strategies: ["Answer"],
  initiatives: ["Continue"],
  humanRead: "Return the greeting.",
});

run({
  name: "Farewell",
  text: "Bye, talk to you later",
  strategies: ["Redirect"],
  initiatives: ["End"],
  humanRead: "Close warmly, leave the door open.",
});

run({
  name: "Direct question",
  text: "What's the weather like today?",
  strategies: ["Answer"],
  initiatives: ["Continue"],
  confidence: ["High"],
  humanRead: "Answer directly.",
});

run({
  name: "Hinglish question",
  text: "Kal kya plan hai?",
  strategies: ["Answer"],
  initiatives: ["Continue"],
  humanRead: "Answer in Hinglish.",
});

run({
  name: "Backchannel",
  text: "Yeah yeah",
  strategies: ["Observe", "Listen"],
  initiatives: ["Observe"],
  clarification: [false],
  humanRead: "Continuation — don't manufacture engagement.",
});

run({
  name: "Backchannel after long silence",
  text: "Hmm",
  ctx: { timing: { silenceDurationMs: 12000, turnCount: 10 } },
  strategies: ["Ask"],
  initiatives: ["Ask"],
  humanRead: "They trailed off; gently re-engage.",
});

run({
  name: "Degraded STT (stt 0.4)",
  text: "grbllx zzt",
  ctx: { input: { sttConfidence: 0.4 } },
  strategies: ["Clarify"],
  initiatives: ["Ask"],
  clarification: [true],
  confidence: ["Low"],
  humanRead: "Never guess what was not heard.",
});

run({
  name: "Hedged input",
  text: "I think maybe we should change the plan",
  strategies: ["Clarify", "Observe", "Ask", "Answer"],
  initiatives: ["Ask", "Continue"],
  clarification: [true],
  humanRead: "They are unsure about their own idea — probe before acting.",
});

run({
  name: "Frustration with strong input",
  text: "This is not working, fix it now",
  ctx: {
    emotion: { frustration: 0.75 },
    behaviorAnalysis: { act: "command", tags: ["command"], intensity: 0.8 },
  },
  strategies: ["Answer"],
  initiatives: ["Continue"],
  humanRead: "High frustration → resolve the problem fast.",
});

run({
  name: "Frustration with weak input",
  text: "ugh ugh",
  ctx: { input: { sttConfidence: 0.5 }, emotion: { frustration: 0.7 } },
  strategies: ["Clarify", "Comfort"],
  initiatives: ["Ask"],
  clarification: [true],
  humanRead: "Frustrated but unheard — clarify gently.",
});

run({
  name: "Sharing / confession",
  text: "I broke up with my girlfriend yesterday",
  ctx: {
    emotion: { vulnerability: 0.5, tension: 0.4 },
    behaviorAnalysis: { act: "share", tags: ["sharing", "story"], intensity: 0.6 },
  },
  strategies: ["Reflect", "Listen"],
  initiatives: ["Observe", "Continue"],
  clarification: [false],
  humanRead: "Presence, not solutions.",
});

run({
  name: "Disagreement",
  text: "I don't think that's right at all",
  ctx: { behaviorAnalysis: { act: "debate", tags: ["disagreement"], intensity: 0.7 } },
  strategies: ["Challenge", "Reflect"],
  initiatives: ["Continue"],
  humanRead: "Engage the disagreement honestly, don't flatten it.",
});

run({
  name: "Emotional peak",
  text: "I got the job! I actually got it!",
  ctx: { emotion: { arc: "peak", energy: 0.8, engagement: 0.9 } },
  strategies: ["Encourage", "Reflect"],
  initiatives: ["Continue"],
  humanRead: "Celebrate with them.",
});

run({
  name: "Long thread consolidation",
  text: "So anyway, back to what we were discussing",
  ctx: { timing: { turnCount: 16 } },
  strategies: ["Summarize", "Answer", "Redirect"],
  initiatives: ["Continue", "Redirect"],
  humanRead: "Re-ground after a long thread.",
});

run({
  name: "STT gray zone with a question",
  text: "Where are the keys?",
  ctx: { input: { sttConfidence: 0.55 } },
  strategies: ["Answer"],
  initiatives: ["Continue", "Ask"],
  clarification: [true],
  confidence: ["Medium"],
  humanRead: "Answer but acknowledge uncertainty in what was heard.",
});

// ─── HUMAN BENCHMARK (measured — mismatches ARE the findings) ────────

run({
  name: "Turn-taking: self-repair",
  text: "Actually... wait... let me explain.",
  ctx: { emotion: { vulnerability: 0.3, tension: 0.2 } },
  strategies: ["Listen", "Observe", "Answer"],
  initiatives: ["Wait", "Observe"],
  clarification: [false],
  benchmark: true,
  humanRead:
    "The user is mid-thought and self-correcting. A human yields the floor (WAIT), does not answer, does not clarify. The user said 'wait' — hold.",
});

run({
  name: "Turn-taking: rejection / misalignment repair",
  text: "No... that's not what I meant.",
  ctx: { emotion: { vulnerability: 0.45, frustration: 0.4, tension: 0.3 } },
  strategies: ["Clarify", "Reflect", "Redirect"],
  initiatives: ["Ask", "Wait"],
  clarification: [true],
  benchmark: true,
  humanRead:
    "The user is rejecting AURA's previous reading — a repair. A human re-orients: acknowledges misalignment and asks ONE question (or restates understanding) rather than plowing ahead.",
});

run({
  name: "Ambiguity disguised as a question",
  text: "Hmm?",
  ctx: { emotion: { vulnerability: 0.3, tension: 0.2 } },
  strategies: ["Clarify", "Ask", "Answer"],
  initiatives: ["Ask", "Continue"],
  clarification: [true, false],
  benchmark: true,
  humanRead:
    "'Hmm?' is a prompt for more, not a request for an answer. A human asks what they mean or asks them to continue — the Ask strategy realizes this; formal clarification is optional.",
});

run({
  name: "Soft correction without confrontation",
  text: "Well... actually I meant the other one",
  ctx: { emotion: { vulnerability: 0.3, tension: 0.2 } },
  strategies: ["Reflect", "Listen", "Answer"],
  initiatives: ["Wait", "Continue", "Observe"],
  clarification: [false],
  benchmark: true,
  humanRead:
    "Another self-repair. The user is re-anchoring their meaning — follow, don't challenge, don't clarify.",
});

run({
  name: "Trailing off (incomplete turn)",
  text: "And then I thought... you know...",
  ctx: { emotion: { vulnerability: 0.4, tension: 0.25 } },
  strategies: ["Listen", "Observe"],
  initiatives: ["Wait", "Observe"],
  clarification: [false],
  benchmark: true,
  humanRead:
    "The user is still thinking out loud. Wait or offer a soft nudge — never a hard answer to a half-thought.",
});

// ─── Scorecard ───────────────────────────────────────────────────────

const gateCount = 15;
console.log("\n══════════════════════════════════════════════");
console.log(
  `GATE CORRECTNESS:   ${gateCount - gateFailures}/${gateCount} scenarios behave per spec`,
);
console.log(
  `HUMAN BENCHMARK:    ${benchmarkTotal - benchmarkMisses}/${benchmarkTotal} scenarios match a human conversationalist`,
);
console.log("══════════════════════════════════════════════");
if (benchmarkTotal > 0) {
  console.log(
    `Decision Accuracy (human comparison): ${Math.round(((benchmarkTotal - benchmarkMisses) / benchmarkTotal) * 100)}%`,
  );
}
console.log(`\n${gateFailures === 0 ? "GATE SUITE PASS" : `${gateFailures} GATE FAILURE(S)`}`);
process.exitCode = gateFailures === 0 ? 0 : 1;
