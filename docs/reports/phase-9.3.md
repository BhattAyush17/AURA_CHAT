# AURA Phase 9.3 — Memory Influence Audit

Question asked: **does memory change the response?** Measured dimensions:
Retrieved / Selected / Injected / Referenced / Useful / Ignored / Repeated / Hallucinated.

Method: code trace of the full memory pipeline (frontend gateway → Executive decision layer
→ backend injection channels → prompt) plus a deterministic harness
(`scripts/test-memory-influence.ts`, 18 assertions, 18/18 pass).

---

## 1. The pipeline — three injection channels, one dead decision layer

**Channels that reach the LLM prompt:**

| Channel | Path | Reaches prompt? |
|---|---|---|
| ChromaDB enrichment (speculative prefetch) | `backend/api/main.py:448-465` prefetch → `:562-567` appended to `behavior_instructions` | ✅ |
| `client_memories` payload (local mode) | `useSarvam.ts:1234` → `:1430` → `main.py:813-820` → `memory_lines` | ✅ |
| Session seed (relational memory) | `main.py:541` seed → `usePromptOrchestrator.ts:132` seedRef → `buildSeedInjection` | ✅ |

**The decision layer:** `MemoryPolicyEngine` ("The Memory Engine retrieves. The Executive
decides usage." — `MemoryPolicy.ts:5`) runs every turn inside `ConversationExecutive.plan()`
(`ConversationExecutive.ts:157`). It gates the `memoryPolicy` plan field and emits a memory
directive when policy ≠ Ignore (`ConversationExecutive.ts:305-307`).

## 2. Measurements

| Dimension | Result |
|---|---|
| **Retrieved** | ✅ Works, but mode-dependent. Local mode: keyword + emotional match, max 5 (`local-memory.ts:228`). Supabase mode: retrieval is server-side; the Executive **sees `retrieved: []` by design** (`memory-gateway.ts:147-152`). |
| **Selected** | The policy engine is correct **when given relevance scores** (harness: 0.85→Required, 0.40→Optional, 0.10→Ignore, emotion-urgency→Optional-over-Required, greeting-guard→Ignore). |
| **Injected** | ✅ 3 channels, capped (400-token format cap `memory-gateway.ts:200-218`; seed ≤2KB enforced by `enforceSizeCeiling`). |
| **Referenced** | ❌ **Not measured anywhere.** No metric in src/ or backend/ checks whether the LLM actually used an injected memory. |
| **Useful** | ✅ Partial but real: `hasPersonalHistory` moves turn-5 from ACQUAINTING to COMFORTABLE (`RegisterState.ts:81`), unlocking CASUAL/PLAYFUL/INTIMATE registers — memory *changes the response* via the register gate. |
| **Ignored** | ⚠️ The policy can only *decide* Ignore — see Finding 1. |
| **Repeated** | ❌ No dedup guard. The same fact can be injected up to 3× in one prompt (chroma + client_memories + seed) with no cross-channel check. |
| **Hallucinated** | ❌ Not measured — no way to distinguish a memory-referenced reply from an LLM-invented one. |

## 3. Findings

1. **The Executive's memory decision layer is dead code in production.** The live context is
   built with `relevanceScores: []` hardcoded (`useSarvam.ts:1320`). `MemoryPolicyEngine`
   therefore computes `bestScore = 0` every turn and can only ever return Ignore (or
   Optional when emotion is urgent). The harness proves "Required" is unreachable: even
   with a retrieved memory present, the live-shaped context yields `policy: Ignore` with
   reason *"no memory clears relevance threshold"*. The intended gate
   (`ConversationExecutive.ts:305-307` memory directive) never fires in production.
2. **The Selector and the Injector disagree.** `MemoryPolicyEngine` would suppress a
   low-relevance memory from the prompt, but the injection channels (chroma, client
   memories) bypass it entirely — the Executive's usage decision is advisory at best,
   ignored at worst.
3. **Referenced/Repeated/Hallucinated are unmeasured.** Memory influence on the actual LLM
   reply is asserted, never verified. No instrumentation exists to tell whether the reply
   used, ignored, repeated, or invented the memory.
4. **Memory does change one thing deterministically** — the relationship register
   (COMFORTABLE unlocks INTIMATE register territory at turn 5 with history vs turn 10
   without, `RegisterState.ts:80-84`). This is the only measured, decision-level
   influence.

## 4. Root causes

- `relevanceScores` was designed as the Executive's input but never wired: the retrieval
  layer returns scores (`MemoryResult.similarity`/`emotional_match`) that are discarded at
  `useSarvam.ts:1319` (only `.content` is mapped).
- The memory decision is structured as *advisory* (`memoryPolicy` in the plan) rather than
  *enforced* on the injection channels — so even a working policy could not have prevented
  injection.
- No reply-side instrumentation (the prompt has memory; the reply is never audited against
  it).

## 5. Recommended fixes (Phase 10 candidates)

1. Wire the selector: map `similarity`/`emotional_match` into `relevanceScores` at
   `useSarvam.ts:1319-1321` (one-line change) — un-dead the Executive's memory layer.
2. Enforce the policy: filter `client_memories` by the plan's `memoryPolicy` before the
   payload leaves the client (reject memories the Executive marked Ignore).
3. Add cross-channel dedup: hash injected memory content across seed/chroma/client channels
   before prompt assembly (`backend/api/main.py` and seed injection).
4. Add reply-side instrumentation: post-hoc check in the stream response for content
   overlap with injected memories (Referenced score), plus a repeated-fact detector.

## 6. Verdict

Memory reaches the model through three channels and changes one decision deterministically
(the register). But the Executive's own memory intelligence — the layer explicitly built to
decide *usage* — is disconnected: it sees empty scores, can only decide Ignore, and would
not be consulted even if it worked. Memory influence today is **injection without
selection, assertion without measurement**: we know memory is in the prompt; we do not know
it changed the reply.
