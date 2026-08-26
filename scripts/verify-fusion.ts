/**
 * Phase C — Evidence-Preserving Fusion verification harness.
 * Run: npx tsx scripts/verify-fusion.ts
 */
import { perceptionFusionLayer, PerceptionFusionLayer } from "../src/sense/PerceptionFusionLayer";
import type { RawSenseObservation } from "../src/sense/SenseManager/types";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

// Helper to create a new clean fusion layer for tests
function createFusion() {
  return new PerceptionFusionLayer();
}

function runTests() {
  // Test 1 — Single observation
  const f1 = createFusion();
  f1.ingest({ source: "voice", timestamp: 1000, estimatedConfidence: 0.8, payload: {} });
  const e1 = f1.flushToATF();
  check("Test 1 — Single observation remains valid", e1.length === 1 && e1[0].confidence === 0.8);

  // Test 2 — Temporal sequence
  const f2 = createFusion();
  f2.ingest({ source: "voice", timestamp: 1000, estimatedConfidence: 0.2, payload: {} });
  f2.flushToATF();
  f2.ingest({ source: "voice", timestamp: 2000, estimatedConfidence: 0.85, payload: {} });
  f2.flushToATF();
  f2.ingest({ source: "voice", timestamp: 3000, estimatedConfidence: 0.15, payload: {} });
  const e2 = f2.flushToATF();
  
  const voiceE2 = e2[0];
  check(
    "Test 2 — Temporal sequence preserves sequence",
    voiceE2.temporal !== undefined && voiceE2.temporal.recent.length === 3
  );
  check(
    "Test 2 — Temporal sequence captures decreasing/sudden_change",
    voiceE2.temporal!.features.includes("decreasing") || voiceE2.temporal!.features.includes("sudden_change")
  );

  // Test 3 — Contradiction
  const f3 = createFusion();
  f3.ingest({ source: "voice", timestamp: 1000, estimatedConfidence: 0.81, payload: { intensity: "high" } });
  f3.ingest({ source: "language", timestamp: 1000, estimatedConfidence: 0.76, payload: { wording: "neutral" } });
  f3.ingest({ source: "vision", timestamp: 1000, estimatedConfidence: 0.63, payload: { engagement: "low" } });
  const e3 = f3.flushToATF();
  check("Test 3 — Contradiction (Multiple sources preserved)", e3.length === 3);

  // Test 4 — Availability
  const f4 = createFusion();
  f4.ingest({ source: "voice", timestamp: 1000, estimatedConfidence: 0.05, payload: {} });
  const e4 = f4.flushToATF();
  check("Test 4 — Availability (Low confidence doesn't mean unavailable)", e4.length === 1 && Math.abs(e4[0].confidence - 0.1) < 0.01); // min confidence is clamped to 0.1

  // Test 5 — Stale evidence
  const f5 = createFusion();
  f5.ingest({ source: "voice", timestamp: 1000, estimatedConfidence: 0.9, payload: {} });
  f5.flushToATF();
  // Next tick, no ingest
  const e5 = f5.flushToATF();
  check("Test 5 — Stale evidence (Does not masquerade as current)", e5.length === 0);

  // Test 6 — Confidence
  const f6 = createFusion();
  f6.ingest({ source: "vision", timestamp: 1000, estimatedConfidence: 0.42, payload: {} });
  const e6 = f6.flushToATF();
  check("Test 6 — Confidence (Attached to observation)", e6.length === 1 && Math.abs(e6[0].confidence - 0.42) < 0.01);

  // Test 7 — Baseline insufficiency
  const f7 = createFusion();
  f7.ingest({ source: "voice", timestamp: 1000, estimatedConfidence: 0.5, payload: {} });
  f7.flushToATF();
  f7.ingest({ source: "voice", timestamp: 2000, estimatedConfidence: 0.6, payload: {} });
  const e7 = f7.flushToATF();
  check("Test 7 — Baseline insufficiency (No fabricated baseline)", e7[0].temporal!.baseline === undefined);

  // Test 8 — Empty evidence
  const f8 = createFusion();
  const e8 = f8.flushToATF();
  check("Test 8 — Empty evidence (Existing empty behavior unchanged)", e8.length === 0);

  console.log(`\n${failures === 0 ? "ALL FUSION CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

runTests();
