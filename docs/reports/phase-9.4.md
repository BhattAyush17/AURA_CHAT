# AURA Phase 9.4 — Reflection Audit

Question asked: **does reflect() change subsequent behavior, or is it just logging?**

Method: 50/100/200-turn simulations through the real `ConversationExecutive` (plan →
reflect → plan) with controlled user patterns, plus a reachability analysis of every
weight ratchet and every forcing gate. Harness: `scripts/test-reflection.ts`
(16 assertions, 16/16 pass).

---

## 1. What reflection is

`ReflectionEngine.reflect()` (per completed turn, `ConversationExecutive.ts:241`) computes
signals from `userReactedNegatively` + `userFollowedUp` + the plan, then ratchets three
persistent weights (`ReflectionEngine.ts:45-49, 110-127`), each ±0.05/turn capped at ±1:

- **clarifyBias** → forced clarification if > 0.5 (`ConversationExecutive.ts:143-154`)
- **brevityBias** → budget ladder step ±1 if |bias| > 0.15 (`:165-182`)
- **warmthBias** → tone += bias × 0.3 (`:196-199`)

The live caller (`useSarvam.ts:1199-1202`) supplies only two booleans per turn:
interruption flag (negative) and "spoke again within 6s" (follow-up).

## 2. Measurements

| Weight | Ratchet reachable? | Behavioral outlet? | Measured |
|---|---|---|---|
| **brevityBias** (too_short) | ✅ Tiny plan + follow-up, +0.05 | ✅ budget grows Tiny→Short | **Turn 4** (bias −0.15 crosses gate) |
| **brevityBias** (too_long) | ✅ Detailed plan + negative | ✅ budget shrinks Detailed→Normal | **Turn 4** (bias +0.15 crosses gate) |
| **warmthBias** | ✅ low-warmth plan + negative | ✅ tone warms | tone 0.29 → 0.43 over 10 turns |
| **clarifyBias** | ⚠️ reachable only via Medium+clarify=false (interruption turn) | ❌ **no outlet** | ratchets to 0.60; forcing gate never fires |
| **too_long (DeepDive branch)** | ❌ **DeepDive is unproducible** | — | dead code |

Control: without reflection, 200 identical turns produce byte-identical plans — behavior
change is entirely attributable to the weights.

## 3. Findings

1. **The headline weight is behaviorally dead.** `clarifyBias` ratchets only on
   *"clarified too late"* — producible (question + interruption → Answer/Medium/
   clarify=false), and it does accumulate (+0.05/turn, measured 0.60 after 12 turns). But
   the forcing gate at `ConversationExecutive.ts:143-154` requires `confidence === "Low"`
   *with* `clarification.required === false` — and the pipeline never produces that plan
   shape: Low confidence comes from degraded STT, which the ClarificationPolicy turns into
   `Clarify`/clarify=true; clarify=false turns have clean STT, which rates High/Medium.
   The weight moves; nothing listens to it. The one behavior change reflection was built
   for — "start clarifying more" — cannot happen.
2. **DeepDive-based `too_long` is dead code.** `InformationBudgetEngine` emits at most
   `Detailed` (`InformationBudget.ts:54-91`; probes: Short/Detailed only across 6 scenario
   classes). The branch at `ReflectionEngine.ts:75` can never fire.
3. **`too_short` and `too_long` work and demonstrably mutate plans** — both cross the
   ±0.15 gate at exactly 4 ratchets, and the plan's rationale records the adjustment.
   But they operate on *budget only*: 200-turn simulations show strategy and initiative
   are never touched by reflection.
4. **The length-delta input is dead from both ends.** `TurnOutcome.nextTurnLengthDelta` is
   never passed (`useSarvam.ts:1199-1202`) and never read inside `reflect()` — the depth
   calibration that uses the user's actual next-turn length does not exist.
5. **Live signals are coarse.** Negative = interruption only — frustration spikes,
   disengagement, and negative tone never reach reflection. Follow-up = *any* speech within
   6s — an "ok" or a backchannel counts as "thread continued naturally".
6. **Cross-phase dead branch:** the ConfidenceManager's memory-conflict downgrade
   (`ConfidenceManager.ts:27-34`) requires `relevanceScores.length >= 2`, which is never
   populated (Phase 9.3 finding) — one more reflection-adjacent signal that can't fire.

## 4. Root causes

- The forcing gate was written conservatively (Low confidence required) but the pipeline
  invariants make Low+no-clarify impossible — a spec/reality mismatch, not a tuning
  problem.
- Ratchets are correct but only wired to *budget* and *tone*; the strategy and initiative
  layers never listen to reflection, so the socially-important learning (when to clarify,
  when to hold) has no channel.
- The live caller reduces a rich outcome (length delta, frustration, disengagement) to
  two booleans.

## 5. Recommended fixes (Phase 10 candidates)

1. **Unlock clarifyBias:** relax the forcing gate to `confidence.label !== "High"` (drop
   the Low requirement) or route clarifyBias into `ClarificationPolicy` as an input
   threshold shift (raise the STT clarify threshold by bias × 0.1). The ratchet then has
   an outlet.
2. **Wire `nextTurnLengthDelta`:** pass the user's previous-utterance word count (already
   available in the transcript) into `reflect()` and use it as a real depth-calibration
   signal.
3. **Enrich live signals:** negative = interruption OR frustration spike (compare turn
   emotion vs rolling baseline); follow-up = follow-up on *topic* (not 6s proximity).
4. **Remove or implement DeepDive:** either extend InformationBudgetEngine (e.g. heavy
   technical + engagement → DeepDive) or delete the dead branch.
5. **Let reflection reach strategy:** e.g. repeat `strategy_ineffective` on the same
   strategy could shift a secondary strategy choice — giving reflection a social channel.

## 6. Verdict

Reflection is **not just logging** — two of three weights measurably change what AURA does
(budget depth, tone warmth), with deterministic flip points. But the most important
learning loop — *"I keep clarifying too late; I should clarify more"* — is disconnected
from the decisions it is supposed to change, the DeepDive branch is unreachable, the
length-delta input is unused, and the live outcome signals are two coarse booleans.
Reflection today tunes *how much* AURA says and *how warm* she sounds; it cannot yet tune
*what she decides*.
