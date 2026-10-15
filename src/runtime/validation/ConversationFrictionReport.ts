/**
 * ConversationFrictionReport — per-session conversation-quality metrics.
 *
 * Single source of truth for `SessionStats` accumulation and the friction
 * verdict. Shared by the live Sarvam voice hook (`useSarvam`) and the
 * Phase 7.2 validation harness (`scripts/test-perception.ts`).
 *
 * The score is friction-free out of 100: it starts at 100 and subtracts a
 * turn-normalised penalty for the behaviours that make a conversation feel
 * effortful — interrupting, over-clarifying, aborted streams and dead air.
 * Normalising by turns keeps short and long sessions comparable.
 */

export interface SessionStats {
  turns: number;
  interruptions: number;
  heldThoughts: number;
  abortedStreams: number;
  backchannels: number;
  proactiveTriggers: number;
  clarifies: number;
  hesitations: number;
  deadAirMs: number[];
}

export const emptySessionStats = (): SessionStats => ({
  turns: 0,
  interruptions: 0,
  heldThoughts: 0,
  abortedStreams: 0,
  backchannels: 0,
  proactiveTriggers: 0,
  clarifies: 0,
  hesitations: 0,
  deadAirMs: [],
});

export type FrictionVerdict = "excellent" | "acceptable" | "strained" | "broken";

export interface FrictionRates {
  /** heldThoughts / interruptions — did held-back speech survive an interruption? */
  recoveryRate: number;
  /** interruptions / turns */
  interruptionRate: number;
  /** clarifies / turns */
  clarifyRate: number;
}

export interface FrictionReport {
  /** 0–100, where 100 is a frictionless session. */
  frictionlessScore: number;
  verdict: FrictionVerdict;
  rates: FrictionRates;
}

/** A single stretch of dead air this long (or longer) counts as friction. */
const DEAD_AIR_FRICTION_MS = 3000;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function computeFrictionReport(stats: SessionStats): FrictionReport {
  const turns = Math.max(1, stats.turns);

  const interruptionRate = stats.interruptions / turns;
  const clarifyRate = stats.clarifies / turns;
  const abortedRate = stats.abortedStreams / turns;
  const deadAirRate = stats.deadAirMs.filter((ms) => ms >= DEAD_AIR_FRICTION_MS).length / turns;

  // One interruption in twelve turns costs ~8 points; a fully degraded
  // session (all four rates at 100%) is pinned to 0 by the clamp.
  const penalty = interruptionRate + clarifyRate + abortedRate + deadAirRate;
  const frictionlessScore = clamp(100 - Math.round(penalty * 100), 0, 100);

  const verdict: FrictionVerdict =
    frictionlessScore >= 90
      ? "excellent"
      : frictionlessScore >= 70
        ? "acceptable"
        : frictionlessScore >= 50
          ? "strained"
          : "broken";

  const recoveryRate =
    stats.interruptions > 0 ? round3(stats.heldThoughts / stats.interruptions) : 1;

  return {
    frictionlessScore,
    verdict,
    rates: {
      recoveryRate,
      interruptionRate: round3(interruptionRate),
      clarifyRate: round3(clarifyRate),
    },
  };
}
