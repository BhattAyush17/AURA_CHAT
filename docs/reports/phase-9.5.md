# AURA Phase 9.5 — Relationship Evolution Audit

Question asked: does the professional turn-1 become comfortable / trusting / playful by
turn 150 — within a session and across sessions — and do the relationship boundaries hold
at every stage?

Method: 150-turn + multi-session simulations through the real Phase 8.1 stack
(`determineRelationshipStage`, `RegisterMomentumEngine.observe`, `ConversationExecutive.
observeRegister`, `ALLOWED_BY_STAGE` clamps) with scripted user registers (formal →
casual → playful) and trust growth. Harness: `scripts/test-relationship.ts`
(21 assertions, 21/21 pass).

---

## 1. The arc within a session — works exactly as designed

| Turn | Stage | User register | AURA register |
|---|---|---|---|
| 1 | NEW | formal | **PROFESSIONAL** ✅ (never casual/playful/intimate) |
| 3 | ACQUAINTING | casual | CASUAL |
| 10 | COMFORTABLE | casual | CASUAL |
| 20 | INTIMATE (trust ≥ 0.65) | playful | PLAYFUL |
| 150 | INTIMATE | playful | PLAYFUL |

Measured: stage is forward-only (never regresses over 150 turns); trust is a hard gate
(0.64 at turn 20 ≠ INTIMATE, 0.65 = INTIMATE); register flips are momentum-gated
(window majority + inertia) so a single "bro…" never hijacks the register
(`RegisterState.ts:661-701`).

## 2. Boundaries — every clamp holds

- **NEW stage:** PLAYFUL text → clamped to NEUTRAL; INTIMATE text → clamped to
  CASUAL/NEUTRAL (`clampToRelationship`, `RegisterState.ts:114-129`). Verified: the same
  INTIMATE text is *permitted* at COMFORTABLE (turn 15). The relationship is the gate,
  not the words.
- INTIMATE register only realizes at COMFORTABLE+; PLAYFUL only at ACQUAINTING+.

## 3. Across sessions — the relationship resets

| Session 2 turn | Stage (with history) | vs no history |
|---|---|---|
| 1 | **NEW** (INTIMATE not carried) | NEW |
| 3 | ACQUAINTING | ACQUAINTING |
| 5 | **COMFORTABLE** (memory shortcut) | ACQUAINTING |
| 20 | INTIMATE (trust 0.8) | COMFORTABLE |

Measured: `hasPersonalHistory` only shortcuts ACQUAINTING→COMFORTABLE (turn 5); the
momentum window is per-session (register restarts at NEUTRAL); **INTIMATE must be
re-earned over 20 turns of every session**.

## 4. Findings

1. **Intimacy is re-earned, not remembered.** A 10-session relationship with trust 1.0
   still restarts at NEW every session; trust gates only the turn-20 check
   (`RegisterState.ts:80`). The seed (relational memory) carries the *thread* and trust
   back, but the stage ladder ignores both until turn thresholds are met.
2. **Trust is the only session-persistent relationship signal — and it is not computed
   deterministically on the client** (backend sensing, per-session temporal decay
   `sensing.py:126`, seeded from stored trust). The frontend just forwards
   `sensing.trust ?? lastAnalysis.trust ?? 0.5` (`useSarvam.ts:1310`).
3. **The one memory shortcut is asymmetric:** memory accelerates COMFORTABLE (turn 10 →
   5) but does nothing for ACQUAINTING (3) or INTIMATE (20). The most valuable rung
   (INTIMATE) has no persistence path.
4. **Stage is monotonic only within a session** — the "ladder only moves forward"
   invariant (`RegisterState.ts:75`) resets at every session boundary by construction.

## 5. Recommended fixes (Phase 10 candidates)

1. **Persist relationship across sessions:** make `determineRelationshipStage` accept
   `carriedTrust`/`previousStage` (from the seed) and fold it in, e.g. INTIMATE at
   turn ≥ 10 (instead of 20) when the seed records an established intimate bond with
   trust ≥ 0.7 — the same deterministic pattern, one parameter.
2. **Let trust do more:** e.g. stage floor from trust — trust ≥ 0.75 with personal history
   floors the stage at COMFORTABLE from turn 1 of the new session.
3. **Symmetrize the memory shortcut** (ACQUAINTING→turn 1 with history) so a returning
   user is never greeted as a stranger by the register engine.
4. **Expose the seed's relationship fields** (trust, thread, stage) in the Phase 8.1
   identity snapshot so the Executive can use them in stage decisions and the harness can
   assert persistence.

## 6. Verdict

Within a session the relationship arc is exactly what the spec asks: professional at
turn 1, comfortable by turn 5-10, playful by turn 60, intimate at turn 20 with trust —
and every boundary holds (playful/intimate are structurally impossible too early).
Across sessions, however, AURA forgets how close she is: the ladder restarts at NEW, and
the memory system only shortens one rung. The relationship is well-governed in the
moment and unremembered between moments.
