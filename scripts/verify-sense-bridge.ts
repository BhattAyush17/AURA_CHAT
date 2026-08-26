/**
 * Phase A — Fusion → Cognition bridge verification harness.
 * Run: npx tsx scripts/verify-sense-bridge.ts
 *
 * Proves the Phase A invariants headlessly (no browser, no mic):
 *   A. Backward compatibility: processTurn(text, behavior) two-arg call still works.
 *   B. Empty-evidence safety: consecutive identical turns produce byte-identical
 *      cognitive blocks (Math.random stubbed for a deterministic ending planner).
 *   C. Evidence delivery: with meaningful evidence the ONLY delta is the injected
 *      [SENSE EVIDENCE] block — stripping it restores the empty-path output.
 *   D. No synthetic evidence: sub-threshold confidence is filtered out; the
 *      output is byte-identical to the empty-evidence path.
 */
import { ConversationInterpreter } from "../src/runtime/conversationInterpreter/ConversationInterpreter";
import type { SenseEvidenceV1 } from "../src/sense/SenseManager/types";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const realRandom = Math.random;
Math.random = () => 0.42; // deterministic ending planner across the harness

const interpreter = ConversationInterpreter.getInstance();
const userText = "I'm actually a bit worried about tomorrow";

const playingMusic: SenseEvidenceV1 = {
  version: 1,
  source: "music",
  timestamp: Date.now(),
  confidence: 0.95,
  payload: {
    playback: { isPlaying: true, trackTitle: "Interstellar", trackArtist: "Hans Zimmer" },
  },
};
const idleMusic: SenseEvidenceV1 = { ...playingMusic, confidence: 0.2 };

try {
  // ── A. Backward compatibility ────────────────────────────────────
  const legacy = interpreter.processTurn(userText, null);
  check(
    "A1 two-arg legacy signature works",
    typeof legacy === "string" && legacy.length > 0,
    "processTurn(text, behavior) must keep working",
  );

  // ── B. Empty-evidence safety ─────────────────────────────────────
  const emptyA = interpreter.processTurn(userText, null, []);
  const emptyB = interpreter.processTurn(userText, null, []);
  check("B1 consecutive empty-evidence turns are byte-identical", emptyA === emptyB);
  check("B2 empty path contains no [SENSE EVIDENCE] marker", !emptyA.includes("[SENSE EVIDENCE]"));
  check(
    "B3 empty path keeps cognitive landmarks",
    emptyA.includes("[COGNITIVE ORCHESTRATION]") &&
      emptyA.includes("[HUMAN EXPRESSION ARCHITECTURE]"),
  );

  // ── C. Evidence delivery ─────────────────────────────────────────
  const evHigh = interpreter.processTurn(userText, null, [playingMusic]);
  const sIdx = evHigh.indexOf("[SENSE EVIDENCE]");
  const eIdx = evHigh.indexOf("[/SENSE EVIDENCE]");
  check("C1 evidence block is present", sIdx >= 0 && eIdx > sIdx, `sIdx=${sIdx} eIdx=${eIdx}`);
  // Strip the evidence block INCLUDING its framing newlines — the assertion is
  // that the remainder is byte-identical to the empty-evidence output.
  const blockStart = sIdx > 0 && evHigh[sIdx - 1] === "\n" ? sIdx - 1 : sIdx;
  const markerEnd = eIdx + "[/SENSE EVIDENCE]".length;
  const blockEnd = evHigh[markerEnd] === "\n" ? markerEnd + 1 : markerEnd;
  const stripped = evHigh.slice(0, blockStart) + evHigh.slice(blockEnd);
  check("C2 evidence block (incl. framing) is the ONLY delta vs empty path", stripped === emptyB);
  check(
    "C3 evidence identifies source and confidence",
    evHigh.includes("[music]") && evHigh.includes("0.95"),
  );

  // ── D. No synthetic evidence ─────────────────────────────────────
  const emptyC = interpreter.processTurn(userText, null, []);
  const evLow = interpreter.processTurn(userText, null, [idleMusic]);
  check("D1 sub-threshold evidence filtered out (byte-identical)", evLow === emptyC);
  check("D2 low-confidence output contains no marker", !evLow.includes("[SENSE EVIDENCE]"));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
} finally {
  Math.random = realRandom;
}

process.exit(failures === 0 ? 0 : 1);
