/**
 * Phase D — Decision Layer Activation verification harness.
 * Run: npx tsx scripts/verify-decision.ts
 */
import { RuntimeManager } from "../src/runtime/RuntimeManager";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function runTests() {
  const manager = RuntimeManager.getInstance();

  // 1. SPEAK behavior test
  const speakExecution = manager.evaluateDecision("Yes, I understand what you are saying.", "", 500, 500);
  check(
    "Test 1 — Normal transcript routes to SPEAK behavior",
    speakExecution !== undefined && speakExecution.action === "SPEAK"
  );

  // 2. BACKCHANNEL behavior test
  // "FollowUp" intent from HRTE maps to "Anticipatory" -> "BACKCHANNEL"
  // "and then" is a FollowUp intent according to TimingClassifiers.ts
  const backchannelExecution = manager.evaluateDecision("And then...", "", 200, 200);
  check(
    "Test 2 — Short/Follow-up transcripts route to BACKCHANNEL behavior",
    backchannelExecution !== undefined && backchannelExecution.action === "BACKCHANNEL"
  );

  // 3. WAIT behavior test
  // Low confidence and short text should route to WAIT.
  // Wait, confidence in evaluateStream comes from EndpointConfidenceEngine.
  // If it's very short like "a", confidence might be low.
  const waitExecution = manager.evaluateDecision("uh", "", 100, 100);
  check(
    "Test 3 — Extremely short uncertain transcript routes to WAIT behavior",
    waitExecution !== undefined && waitExecution.action === "WAIT"
  );

  // 4. Decision Telemetry (Failure handling logic fallback)
  // Even if intent is unknown, it should route to SPEAK rather than throwing an error.
  const defaultExecution = manager.evaluateDecision("some random long unclassified text that doesn't match intents", "", 500, 500);
  check(
    "Test 4 — Unknown intent safely falls back to SPEAK behavior",
    defaultExecution !== undefined && defaultExecution.action === "SPEAK"
  );

  console.log(`\n${failures === 0 ? "ALL DECISION CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

runTests();
