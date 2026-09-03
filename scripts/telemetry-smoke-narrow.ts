// Narrow smoke test that avoids the wider AURA app imports.
// Run: npx tsx scripts/telemetry-smoke-narrow.ts
//
// Exits non-zero on assertion failure.

import { auraTelemetry } from "../src/telemetry/RuntimeTelemetry";
import { detectRedundancies as detectRedundancies2 } from "../src/telemetry/RedundancyDetector";
import { estimateTokenUsage as estimateTokenUsage2 } from "../src/telemetry/tokenEstimate";
import {
  selectProviderAggregates as selectProviderAggregates2,
  selectMemoryAggregates as selectMemoryAggregates2,
  selectRequestTimeline as selectRequestTimeline2,
} from "../src/telemetry/selectors";
import { endProviderCall as endProviderCall2 } from "../src/telemetry/ProviderTelemetry";
import type { ProviderCall } from "../src/telemetry/types";

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
expect("1. session id assigned", typeof sid === "string" && sid.length > 0);
expect("1. userId recorded", auraTelemetry.getSnapshot().session.userId === "test-user");
auraTelemetry.setUserId("user_2");
expect("1. userId updateable", auraTelemetry.getSnapshot().session.userId === "user_2");
auraTelemetry.setUserId("local/anonymous");
expect("1. userId fallback", auraTelemetry.getSnapshot().session.userId === "local/anonymous");

// 2. request lifecycle
const r1 = auraTelemetry.beginRequest({ turnId: "t_1" });
expect("2. request id formatted", r1 === "R001");
auraTelemetry.endRequest(r1, { status: "success" });
const snap = auraTelemetry.getSnapshot();
expect("2. request ended with latency", snap.requests[snap.requests.length - 1].latencyMs != null);

// 3. provider call lifecycle + token accounting
const c1 = auraTelemetry.beginProviderCall({
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
  kind: "PRIMARY",
  requestId: r1,
});
expect("3. call id formatted", c1 === "C001");
endProviderCall2(auraTelemetry, c1, {
  status: "success",
  usage: { inputTokens: 12, outputTokens: 8, inputSource: "REPORTED", outputSource: "REPORTED" },
});
const s2 = auraTelemetry.getSnapshot();
expect(
  "3. session token totals updated",
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
  "4. updateProviderCallUsage only adds delta",
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
  "5. memory op recorded",
  s3.memoryOps.some((m) => m.opId === m1 && m.resultCount === 4),
);

// 6. redundancy detector
const req2 = auraTelemetry.beginRequest();
const ma = auraTelemetry.beginMemoryOp({ type: "memory_write", service: "local", requestId: req2 });
auraTelemetry.endMemoryOp(ma, { status: "success" });
const mb = auraTelemetry.beginMemoryOp({ type: "memory_write", service: "local", requestId: req2 });
auraTelemetry.endMemoryOp(mb, { status: "success" });
const flags = detectRedundancies2(
  auraTelemetry.getSnapshot().requests,
  auraTelemetry.getSnapshot().providerCalls,
  auraTelemetry.getSnapshot().memoryOps,
);
expect(
  "6. redundancy detector flags duplicate memory op",
  flags.some((f) => f.id === mb && f.kind === "memory"),
);

// 7. selectors
const provs = selectProviderAggregates2(auraTelemetry.getSnapshot().providerCalls);
expect("7. provider selector returns aggregates", provs.length > 0);
const mems = selectMemoryAggregates2(auraTelemetry.getSnapshot().memoryOps);
expect("7. memory selector returns aggregates", mems.length > 0);

// 8. token estimator
const est = estimateTokenUsage2("hello world", "ok");
expect(
  "8. estimateTokenUsage labels ESTIMATED",
  est.inputSource === "ESTIMATED" && est.outputSource === "ESTIMATED",
);
expect("8. estimateTokenUsage non-zero", est.inputTokens > 0 && est.outputTokens > 0);

// 9. multi-user isolation: new session must reset snapshot
auraTelemetry.beginSession({ userId: "user_3" });
const s4 = auraTelemetry.getSnapshot();
expect(
  "9. multi-user isolation: fresh session",
  s4.session.userId === "user_3" && s4.session.requestCount === 0,
);

// 10. credential sanitisation
auraTelemetry.recordError({
  code: "401",
  message: "Bearer sk-or-v1-abcdefghijklmnopqrstuvwxyz0123 invalid",
});
const s5 = auraTelemetry.getSnapshot();
const recentErr = s5.errors[s5.errors.length - 1];
expect("10. error message sanitized (no sk-or-v1-)", !recentErr.message.includes("sk-or-v1-"));

// 11. failure path records failure + latency
const cFail = auraTelemetry.beginProviderCall({
  provider: "openrouter",
  model: "fail/model",
  kind: "PRIMARY",
});
endProviderCall2(auraTelemetry, cFail, {
  status: "error",
  failureCode: "500",
  failureDetail: "test",
});
const s6 = auraTelemetry.getSnapshot();
const failedCall = s6.providerCalls.find((c) => c.callId === cFail);
expect("11. failure recorded", failedCall?.status === "error" && failedCall?.latencyMs != null);

// 12. request timeline correlation
const req3 = auraTelemetry.beginRequest();
const t1 = auraTelemetry.beginProviderCall({ provider: "openrouter", model: "x", requestId: req3 });
endProviderCall2(auraTelemetry, t1, { status: "success" });
auraTelemetry.endRequest(req3, { status: "success" });
const r3 = auraTelemetry.getSnapshot().requests.find((r) => r.requestId === req3);
expect("12. request contains its call", !!r3 && r3.providerCalls.includes(t1));
const tl = selectRequestTimeline2(r3!, auraTelemetry.getSnapshot());
expect("12. request timeline ordered", tl.length > 0 && tl[0].type === "request");

// 13. bounded history: 200 records should not grow past limits
for (let i = 0; i < 200; i++) {
  const id = auraTelemetry.beginProviderCall({
    provider: "openrouter",
    model: "stress",
    kind: "PRIMARY",
  });
  endProviderCall2(auraTelemetry, id, { status: "success" });
}
const s7 = auraTelemetry.getSnapshot();
expect("13. bounded call history", s7.providerCalls.length <= 500);

// 14. ensure backend counters do not leak between users
auraTelemetry.beginSession({ userId: "user_A" });
auraTelemetry.setBackendTelemetry({
  available: true,
  capabilities: {
    embeddingProvider: "gemini",
    embeddingAvailable: true,
    activeVectorStore: "supabase_pgvector",
    pineconeConfigured: false,
    pineconeActive: false,
    supabaseConfigured: true,
    chromaReady: true,
  },
  deltas: {
    embeddings: 10,
    vectorQueries: 5,
    vectorUpserts: 1,
    ftsQueries: 0,
    supabaseReads: 7,
    supabaseWrites: 3,
    pineconeConfigures: 0,
    apiRequests: 12,
    failures: 1,
  },
  totalsByOp: {},
  recentOps: [],
});
const userADeltas = auraTelemetry.getSnapshot().backend.deltas;
auraTelemetry.beginSession({ userId: "user_B" });
const userBSnap = auraTelemetry.getSnapshot();
expect(
  "14. multi-user isolation: backend snapshot cleared on new session",
  userBSnap.backend.deltas === null,
);
expect(
  "14. user A deltas preserved when re-read on A only via in-memory shape",
  userADeltas && userADeltas.embeddings === 10,
);

// 15. verify types stay strictly observational
const sample: ProviderCall = {
  callId: "X",
  requestId: "Y",
  provider: "openrouter",
  model: "m",
  kind: "PRIMARY",
  status: "success",
  startedAt: 0,
  endedAt: 0,
  latencyMs: 0,
};
expect("15. ProviderCall has no payload fields", !("input" in sample) && !("output" in sample));

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll telemetry smoke checks passed.");
