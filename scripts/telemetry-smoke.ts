// Manual smoke test for the AURA Runtime Telemetry frontend store.
// Run: npx tsx scripts/telemetry-smoke.ts
//
// Exits non-zero on assertion failure. No production code touched.

import {
  auraTelemetry,
  detectRedundancies,
  estimateTokenUsage,
  endProviderCall,
  selectProviderAggregates,
  selectMemoryAggregates,
} from "../src/telemetry";

let failures = 0;
function expect(label: string, cond: boolean, info?: unknown) {
  if (!cond) {
    failures += 1;
    console.error(`✗ ${label}`, info ?? "");
  } else {
    console.log(`✓ ${label}`);
  }
}

// 1. session lifecycle + identity
const sid = auraTelemetry.beginSession({ userId: "test-user" });
expect("session id assigned", typeof sid === "string" && sid.length > 0);
expect("userId recorded", auraTelemetry.getSnapshot().session.userId === "test-user");
auraTelemetry.setUserId("user_2");
expect("userId updateable", auraTelemetry.getSnapshot().session.userId === "user_2");
auraTelemetry.setUserId("local/anonymous");
expect("userId fallback", auraTelemetry.getSnapshot().session.userId === "local/anonymous");

// 2. request lifecycle
const r1 = auraTelemetry.beginRequest({ turnId: "t_1" });
expect("request id formatted", r1 === "R001");
auraTelemetry.endRequest(r1, { status: "success" });
const snap = auraTelemetry.getSnapshot();
expect("request ended with latency", snap.requests[snap.requests.length - 1].latencyMs != null);

// 3. provider call lifecycle + token accounting
const c1 = auraTelemetry.beginProviderCall({
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
  kind: "PRIMARY",
  requestId: r1,
});
expect("call id formatted", c1 === "C001");
endProviderCall(auraTelemetry, c1, {
  status: "success",
  usage: { inputTokens: 12, outputTokens: 8, inputSource: "REPORTED", outputSource: "REPORTED" },
});
const s2 = auraTelemetry.getSnapshot();
expect(
  "session token totals updated",
  s2.session.tokenInputTotal >= 12 && s2.session.tokenOutputTotal >= 8,
);

// 4. live session update (delta not double-count)
const gemCall = auraTelemetry.beginProviderCall({
  provider: "gemini",
  model: "models/gemini-3.1-flash-live-preview",
  kind: "PRIMARY",
  audio: true,
});
auraTelemetry.updateProviderCallUsage(gemCall, {
  inputTokens: 100,
  outputTokens: 50,
  inputSource: "REPORTED",
  outputSource: "REPORTED",
});
const afterFirst = auraTelemetry.getSnapshot();
const firstIn = afterFirst.session.tokenInputTotal;
auraTelemetry.updateProviderCallUsage(gemCall, {
  inputTokens: 150,
  outputTokens: 70,
  inputSource: "REPORTED",
  outputSource: "REPORTED",
});
const afterSecond = auraTelemetry.getSnapshot();
expect(
  "updateProviderCallUsage only adds delta",
  afterSecond.session.tokenInputTotal - firstIn === 50,
  {
    delta: afterSecond.session.tokenInputTotal - firstIn,
  },
);
auraTelemetry.endProviderCall(gemCall, { status: "success" });

// 5. memory op lifecycle
const m1 = auraTelemetry.beginMemoryOp({ type: "memory_retrieval", service: "supabase" });
auraTelemetry.endMemoryOp(m1, { status: "success", resultCount: 4 });
const s3 = auraTelemetry.getSnapshot();
expect(
  "memory op recorded",
  s3.memoryOps.some((m) => m.opId === m1 && m.resultCount === 4),
);

// 6. redundancy detector
const req2 = auraTelemetry.beginRequest();
const ma = auraTelemetry.beginMemoryOp({ type: "memory_write", service: "local", requestId: req2 });
auraTelemetry.endMemoryOp(ma, { status: "success" });
const mb = auraTelemetry.beginMemoryOp({ type: "memory_write", service: "local", requestId: req2 });
auraTelemetry.endMemoryOp(mb, { status: "success" });
const flags = detectRedundancies(
  auraTelemetry.getSnapshot().requests,
  auraTelemetry.getSnapshot().providerCalls,
  auraTelemetry.getSnapshot().memoryOps,
);
expect(
  "redundancy detector flags duplicate memory op",
  flags.some((f) => f.id === mb && f.kind === "memory"),
);

// 7. selectors
const provs = selectProviderAggregates(auraTelemetry.getSnapshot().providerCalls);
expect("provider selector returns aggregates", provs.length > 0);
const mems = selectMemoryAggregates(auraTelemetry.getSnapshot().memoryOps);
expect("memory selector returns aggregates", mems.length > 0);

// 8. token estimator
const est = estimateTokenUsage("hello world", "ok");
expect(
  "estimateTokenUsage labels ESTIMATED",
  est.inputSource === "ESTIMATED" && est.outputSource === "ESTIMATED",
);
expect("estimateTokenUsage non-zero", est.inputTokens > 0 && est.outputTokens > 0);

// 9. multi-user isolation: new session must reset snapshot
auraTelemetry.beginSession({ userId: "user_3" });
const s4 = auraTelemetry.getSnapshot();
expect(
  "multi-user isolation: fresh session",
  s4.session.userId === "user_3" && s4.session.requestCount === 0,
);

// 10. credentials never stored
const withSecrets = auraTelemetry.recordError({
  code: "401",
  message: "Bearer sk-or-v1-abcdefghijklmnopqrstuvwxyz0123 invalid",
});
const s5 = auraTelemetry.getSnapshot();
const recentErr = s5.errors[s5.errors.length - 1];
expect("error message sanitized (no sk-or-v1-)", !recentErr.message.includes("sk-or-v1-"));

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll telemetry smoke checks passed.");
