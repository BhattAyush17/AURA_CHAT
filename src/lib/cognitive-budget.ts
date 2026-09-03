/**
 * Phase 1 cognitive-integrity fix (C5): bounded cognitive representation.
 *
 * The backend validates `cognitive_block` with `max_length=4000` (enforced at
 * 3999 — a 4000-char block returns 422 and drops ALL cognition for the turn).
 * A rich turn (identity + memory + social + attention + atmosphere + evidence +
 * human state + adaptive profile + expression) can approach that cap.
 *
 * This helper guarantees the block stays under budget by removing complete
 * sections in strict PRIORITY order — supporting metadata first, important
 * context next, and never touching the critical generation-control sections
 * unless nothing else can bring it under budget. It is deterministic and cannot
 * corrupt or merge sections (each removal targets one exact known section).
 *
 * Assembly order in ConversationInterpreter.processTurn (highest priority first):
 *   1. [COGNITIVE ORCHESTRATION]            -> CRITICAL (generation control)
 *   2. [USER IDENTITY]                      -> IMPORTANT
 *   3. [RELEVANT MEMORY]                    -> IMPORTANT
 *   4. [CONVERSATIONAL INTENT] / [RESPONSE DECISION] / [CONTINUITY] / [OBSERVATION] -> IMPORTANT
 *   5. [ENVIRONMENT CONTEXT]                -> SUPPORTING (relevance-gated)
 *   6. [ADAPTIVE ATTENTION]                 -> CRITICAL (generation control)
 *   7. [SENSE EVIDENCE]                     -> SUPPORTING
 *   8. [HUMAN STATE (PROBABILISTIC)]        -> SUPPORTING
 *   9. [AURA PERSONALITY MODE] / [METACOGNITIVE…] / [CURRENT COMMUNICATION SIGNAL] -> SUPPORTING
 *   10. [HUMAN EXPRESSION ARCHITECTURE]     -> SUPPORTING (lowest)
 *
 * Degradation removes section 10 first (lowest priority), then the rest of the
 * SUPPORTING tier, then the IMPORTANT tier. Critical sections are only dropped
 * as a last resort if a turn is so oversized that even they exceed the budget.
 */

/** Safe ceiling: comfortably below the backend's effective 3999 cap. */
export const COGNITIVE_BLOCK_BUDGET = 3900;

interface SectionSpec {
  open: string;
  close: string;
}

// NOTE: [HUMAN STATE (PROBABILISTIC)] closes with [/HUMAN STATE] (name differs).
const SUPPORTING_SECTIONS: SectionSpec[] = [
  { open: "[HUMAN EXPRESSION ARCHITECTURE]", close: "[/HUMAN EXPRESSION ARCHITECTURE]" },
  { open: "[CURRENT COMMUNICATION SIGNAL]", close: "[/CURRENT COMMUNICATION SIGNAL]" },
  {
    open: "[METACOGNITIVE & LONGITUDINAL USER MODEL]",
    close: "[/METACOGNITIVE & LONGITUDINAL USER MODEL]",
  },
  { open: "[AURA PERSONALITY MODE]", close: "[/AURA PERSONALITY MODE]" },
  { open: "[HUMAN STATE (PROBABILISTIC)]", close: "[/HUMAN STATE]" },
  { open: "[SENSE EVIDENCE]", close: "[/SENSE EVIDENCE]" },
  { open: "[ENVIRONMENT CONTEXT]", close: "[/ENVIRONMENT CONTEXT]" },
];

const IMPORTANT_SECTIONS: SectionSpec[] = [
  // Social cognition is one logical tier; each sub-block is removed independently.
  { open: "[RESPONSE DECISION]", close: "[/RESPONSE DECISION]" },
  { open: "[CONTINUITY]", close: "[/CONTINUITY]" },
  { open: "[OBSERVATION]", close: "[/OBSERVATION]" },
  { open: "[CONVERSATIONAL INTENT]", close: "[/CONVERSATIONAL INTENT]" },
  { open: "[RELEVANT MEMORY]", close: "[/RELEVANT MEMORY]" },
  { open: "[USER IDENTITY]", close: "[/USER IDENTITY]" },
];

const CRITICAL_SECTIONS: SectionSpec[] = [
  { open: "[ADAPTIVE ATTENTION]", close: "[/ADAPTIVE ATTENTION]" },
  { open: "[COGNITIVE ORCHESTRATION]", close: "[/COGNITIVE ORCHESTRATION]" },
];

/** Remove one exact section if present and well-formed; otherwise return input. */
function removeSection(text: string, spec: SectionSpec): string {
  const start = text.indexOf(spec.open);
  if (start === -1) return text;
  const end = text.indexOf(spec.close, start + spec.open.length);
  if (end === -1) return text; // malformed — leave untouched, never corrupt
  const after = end + spec.close.length;
  const merged = (text.slice(0, start) + text.slice(after)).replace(/\n{3,}/g, "\n\n");
  return merged.trim();
}

/** Last-resort trimming at the nearest section/paragraph boundary within budget. */
function truncateAtBoundary(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const hard = text.slice(0, budget);
  const lastBoundary = Math.max(hard.lastIndexOf("\n\n"), hard.lastIndexOf("]\n"));
  if (lastBoundary > budget * 0.6) return hard.slice(0, lastBoundary).trim();
  return hard.trim();
}

export function boundCognitiveBlock(
  block: string | undefined | null,
  budget: number = COGNITIVE_BLOCK_BUDGET,
): string {
  if (!block) return "";
  if (block.length <= budget) return block;

  let out = block;

  // 1. Drop SUPPORTING metadata first (lowest priority).
  for (const spec of SUPPORTING_SECTIONS) {
    if (out.length <= budget) break;
    out = removeSection(out, spec);
  }

  // 2. Drop IMPORTANT context next.
  for (const spec of IMPORTANT_SECTIONS) {
    if (out.length <= budget) break;
    out = removeSection(out, spec);
  }

  // 3. Only if a turn is pathologically oversized do we touch CRITICAL sections
  // (this means the core control surface alone exceeds the budget).
  for (const spec of CRITICAL_SECTIONS) {
    if (out.length <= budget) break;
    out = removeSection(out, spec);
  }

  // 4. Absolute last resort — bounded boundary truncation (never a bare slice).
  if (out.length > budget) {
    out = truncateAtBoundary(out, budget);
  }

  return out.trim() || block.slice(0, budget).trim();
}

/** Compact, prompt-safe music state for the Path-A `music_context_text` field. */
export function boundMusicContextText(
  musicText: string | undefined | null,
  budget: number = 1200,
): string {
  if (!musicText) return "";
  return musicText.length <= budget ? musicText : musicText.slice(0, budget).trimEnd();
}
