/**
 * C1 verification, frontend leg — memory API response -> AURA cognitive context.
 *
 * backend/verify_c1.py proves the chain up to the HTTP response. This proves the
 * last hop: that the exact payload `/api/memory/model/{user_id}` returns is
 * consumed by MemoryGateway, split by tier in RuntimeManager, and rendered into
 * the prompt blocks the LLM sees.
 *
 * `fetch` is stubbed with the real response shape (captured from the live route)
 * so this runs without a backend. Nothing else is mocked — MemoryGateway,
 * ConversationExecutive and ConversationInterpreter are the production objects.
 *
 * Bundle + run:
 *   npx esbuild scripts/verify-c1-frontend.ts --bundle --platform=node --format=esm \
 *     --alias:@=./src --define:import.meta.env='{}' --outfile=/tmp/verify-c1-frontend.mjs
 *   node /tmp/verify-c1-frontend.mjs
 */

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ──`);
}

// ─── Browser shims ──────────────────────────────────────────────────
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

// ─── The live route's response, verbatim shape ──────────────────────
// Matches backend/api/memory_endpoints.py:_get_user_model — `results` entries
// are {content, metadata:{tier}, similarity, emotional_match}.
const ROUTE_RESPONSE = {
  status: "success",
  results: [
    {
      content: "Current topic: sitar practice",
      metadata: { tier: "current" },
      similarity: 0.87,
      emotional_match: 1.0,
    },
    {
      content: "Unresolved: find a sitar teacher nearby",
      metadata: { tier: "recent" },
      similarity: 0.81,
      emotional_match: 1.0,
    },
    {
      content: "User plays the sitar every morning",
      metadata: { tier: "stable" },
      similarity: 0.74,
      emotional_match: 1.0,
    },
    {
      content: "User dislikes raw onions",
      metadata: { tier: "stable" },
      similarity: 0.21,
      emotional_match: 1.0,
    },
  ],
  mental_model: "Active goal: ship AURA. Currently practising sitar.",
  user_model: {},
};

let memoryRouteCalls = 0;
let lastMemoryUrl = "";

(globalThis as any).fetch = async (input: any, _init?: any) => {
  const url = String(input);
  if (url.includes("/health")) {
    // MemoryGateway.initialize() only selects supabase mode when
    // checks.supabase.ok is true (src/lib/memory-gateway.ts:54).
    return new Response(JSON.stringify({ status: "healthy", checks: { supabase: { ok: true } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/api/memory/model/")) {
    memoryRouteCalls++;
    lastMemoryUrl = url;
    return new Response(JSON.stringify(ROUTE_RESPONSE), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  // Everything else the runtime may touch (behavior, telemetry) fails soft.
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

async function main() {
  const { memoryGateway } = await import("../src/lib/memory-gateway");
  const { RuntimeManager } = await import("../src/runtime/RuntimeManager");

  // ── Gateway: mode selection + response consumption ──────────────
  section("memory API response -> MemoryGateway");

  const mode = await memoryGateway.initialize();
  check(
    "gateway selects supabase mode when /health reports ok",
    mode === "supabase",
    `mode=${mode}`,
  );

  const retrieved = await memoryGateway.retrieveMemories("who teaches sitar?", "verify-user", {
    frustration: 0,
    playfulness: 0,
    vulnerability: 0.8,
    trust: 0.7,
    anxiety: 0,
  });
  check(
    "gateway calls /api/memory/model/{user_id}",
    memoryRouteCalls === 1,
    `calls=${memoryRouteCalls}`,
  );
  check(
    "query is forwarded as a search param (drives backend ranking)",
    lastMemoryUrl.includes("query="),
    `url=${lastMemoryUrl}`,
  );
  check(
    "all four results survive the gateway",
    retrieved.length === ROUTE_RESPONSE.results.length,
    `got=${retrieved.length}`,
  );
  check(
    "tier metadata preserved (RuntimeManager splits on it)",
    retrieved.every((m: any) => typeof m.metadata?.tier === "string"),
  );

  // ── Runtime: tier split + prompt rendering ──────────────────────
  section("MemoryGateway -> RuntimeManager -> cognitive context");

  const rm = RuntimeManager.getInstance();
  const block = await rm.processCognitiveTurn("who teaches sitar around here?", null, "adaptive");

  check(
    "route called again for the cognitive turn",
    memoryRouteCalls === 2,
    `calls=${memoryRouteCalls}`,
  );
  check(
    "stable facts reach the [USER IDENTITY] block",
    block.includes("[USER IDENTITY]") && block.includes("sitar every morning"),
    `identity block missing; length=${block.length}`,
  );
  check(
    "non-stable memories reach the [RELEVANT MEMORY] block",
    block.includes("[RELEVANT MEMORY]"),
    "no memory block rendered — MemoryPolicy may have suppressed it",
  );
  check(
    "a retrieved memory is quoted in the prompt",
    /sitar practice|sitar teacher/.test(block),
    "no retrieved content surfaced in the block",
  );
  check(
    "stable facts are NOT duplicated into [RELEVANT MEMORY]",
    !(block.split("[RELEVANT MEMORY]")[1] ?? "").includes("every morning"),
    "stable fact leaked into the memory block as well as identity",
  );

  // The executive's own directive must acknowledge the memory it was given.
  const executivePrompt = rm.getLastExecutivePrompt();
  check(
    "executive plan records a memory policy",
    /memory: |confidence: /.test(executivePrompt),
    `prompt=${JSON.stringify(executivePrompt.slice(0, 80))}`,
  );

  // ── Degradation: a 404 must not look like "no memories" ─────────
  section("404 is distinguishable from an empty result");

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => void warnings.push(args.map(String).join(" "));
  (globalThis as any).fetch = async (input: any) => {
    const url = String(input);
    if (url.includes("/api/memory/model/")) return new Response("Not Found", { status: 404 });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const empty = await memoryGateway.retrieveMemories("q", "verify-user", {});
  console.warn = origWarn;

  check("404 yields an empty array", empty.length === 0);
  check(
    "404 is logged loudly (the C1 symptom was silent)",
    warnings.some((w) => w.includes("404")),
    `warnings=${JSON.stringify(warnings)}`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
