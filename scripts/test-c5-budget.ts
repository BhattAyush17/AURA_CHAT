import {
  boundCognitiveBlock,
  COGNITIVE_BLOCK_BUDGET,
} from "../src/lib/cognitive-budget";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

// Build a realistic cognitive block with sections in assembly order.
function buildBlock(opts: { bigMemory?: boolean } = {}) {
  const memory = opts.bigMemory
    ? Array.from({ length: 60 }, (_, i) => `- memory line number ${i} with some realistic detail content here`)
        .join("\n")
    : "- User loves lo-fi hip hop";
  return [
    "[COGNITIVE ORCHESTRATION]\nstate: Neutral\nintent: Answer\n[/COGNITIVE ORCHESTRATION]",
    "[USER IDENTITY]\n- Name: Priya\n- Preferences: lo-fi\n[/USER IDENTITY]",
    `[RELEVANT MEMORY]\n${memory}\n[/RELEVANT MEMORY]`,
    "[CONVERSATIONAL INTENT]\npurpose: answer\n[/CONVERSATIONAL INTENT]",
    "[OBSERVATION]\nuser shifted topic\n[/OBSERVATION]",
    "[RESPONSE DECISION]\nstance: answer\n[/RESPONSE DECISION]",
    "[ENVIRONMENT CONTEXT]\ntime: night\n[/ENVIRONMENT CONTEXT]",
    "[ADAPTIVE ATTENTION]\nwarmth: 0.80\ndirectness: 0.50\nmode: concise\n[/ADAPTIVE ATTENTION]",
    "[SENSE EVIDENCE]\n- [microphone] confidence 0.70: {}\n[/SENSE EVIDENCE]",
    "[HUMAN STATE (PROBABILISTIC)]\n- Hypothesis: focus (confidence: 0.60)\n[/HUMAN STATE]",
    "[AURA PERSONALITY MODE]\nmode contract\n[/AURA PERSONALITY MODE]",
    "[METACOGNITIVE & LONGITUDINAL USER MODEL]\nanalyzed turns\n[/METACOGNITIVE & LONGITUDINAL USER MODEL]",
    "[CURRENT COMMUNICATION SIGNAL]\nlanguage: english\n[/CURRENT COMMUNICATION SIGNAL]",
  ].join("\n");
}

function tagCheck(text: string, detail: string) {
  const opens = (text.match(/\[(?!\/)[A-Z][A-Z0-9 &()_.-]*\]/g) || []).map((t) =>
    t.replace("[", "").replace("]", ""),
  );
  const closes = (text.match(/\[\/[\w][A-Z0-9 &()_.-]*\]/g) || []).map((t) =>
    t.replace("[/", "").replace("]", ""),
  );
  // Normalize the intentional source-level mismatch: [HUMAN STATE (PROBABILISTIC)]
  // opens but closes with [/HUMAN STATE].
  const norm = (s: string) => s.replace(/ \(PROBABILISTIC\)$/, "");
  const opensN = opens.map(norm);
  const closesN = closes.map(norm);
  for (const c of closesN) {
    if (!opensN.includes(c)) {
      console.log(`  FAIL  tagCheck  unmatched close [/${c}] (${detail})`);
      fail++;
      return false;
    }
  }
  for (const o of opensN) {
    if (!closesN.includes(o)) {
      console.log(`  FAIL  tagCheck  unmatched open [${o}] (${detail})`);
      fail++;
      return false;
    }
  }
  return true;
}

console.log("C5 boundCognitiveBlock deterministic tests\n");

// 1. Under budget -> byte-identical
const small = buildBlock();
check("under-budget returns byte-identical", boundCognitiveBlock(small) === small);

// 2. Slightly over budget -> only the lowest-priority complete section removed.
//    Build starting from `base` and append ONLY the expression block; budget is
//    set just above base length so removing the one appended block brings it under.
const base = buildBlock();
const exprAppend =
  "\n[HUMAN EXPRESSION ARCHITECTURE]\nxxx\n[/HUMAN EXPRESSION ARCHITECTURE]";
const over1 = base + exprAppend;
const exprLen = exprAppend.length;
const budgetSmall = base.length + 5; // > base, < over1; one removal suffices
const trimmed1 = boundCognitiveBlock(over1, budgetSmall);
check(
  "slightly-over removes lowest-priority complete section",
  !trimmed1.includes("[/HUMAN EXPRESSION ARCHITECTURE]") &&
    !trimmed1.includes("[HUMAN EXPRESSION ARCHITECTURE]"),
  `len(base)=${base.length} budget=${budgetSmall} over1=${over1.length} exprLen=${exprLen}`,
);
check(
  "slightly-over preserves critical sections",
  trimmed1.includes("[COGNITIVE ORCHESTRATION]") &&
    trimmed1.includes("[ADAPTIVE ATTENTION]") &&
    trimmed1.includes("[/ADAPTIVE ATTENTION]"),
);
check("slightly-over under budget", trimmed1.length < budgetSmall);
check("slightly-over no malformed tags", tagCheck(trimmed1, "over1"));

// 3. Heavily oversized -> multiple sections removed, critical preserved, < budget.
const big = buildBlock({ bigMemory: true });
check("memory-heavy block > budget", big.length > COGNITIVE_BLOCK_BUDGET);
const trimmedBig = boundCognitiveBlock(big);
check(
  "heavily-oversized under budget",
  trimmedBig.length < COGNITIVE_BLOCK_BUDGET,
  `len=${trimmedBig.length} budget=${COGNITIVE_BLOCK_BUDGET}`,
);
check(
  "heavily-oversized preserves critical sections",
  trimmedBig.includes("[COGNITIVE ORCHESTRATION]") &&
    trimmedBig.includes("[ADAPTIVE ATTENTION]"),
);
check(
  "heavily-oversized retained memory or dropped it cleanly",
  !trimmedBig.includes("[/RELEVANT MEMORY]") ||
    trimmedBig.includes("[RELEVANT MEMORY]"),
);
check("heavily-oversized no malformed tags", tagCheck(trimmedBig, "big"));

// 4. No malformed closing/opening tags on the canonical block after binding.
check("canonical bound result has no malformed tags", tagCheck(boundCognitiveBlock(big), "canonical"));

// 5. Empty/null handling.
check("null returns empty", boundCognitiveBlock(null) === "");
check("undefined returns empty", boundCognitiveBlock(undefined) === "");

// 6. Critical-only oversized (pathological) still yields a <budget result with clean tags.
const critOnly = Array.from({ length: 500 }, (_, i) => `[COGNITIVE ORCHESTRATION]\n${i}\n[/COGNITIVE ORCHESTRATION]`).join("\n");
const trimmedCrit = boundCognitiveBlock(critOnly, 600);
check("pathological critical-only trims under budget", trimmedCrit.length < 600);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
