/**
 * formatSocialContextBlock — renders SocialContext into a compact, prompt-safe
 * "[SOCIAL CONTEXT]" block appended to the shared cognitive representation.
 *
 * ANTI-LEAK CONTRACT:
 *  - NEVER emit relevance scores, signal category names, ContentArea labels,
 *    raw signal names, or any internal evaluation metadata.
 *  - The rendered block is natural-language guidance only.
 *  - This block flows to ALL providers identically through the shared path.
 */

import type { SocialContext } from "./types";
import { RELEVANCE_THRESHOLDS } from "./types";

/**
 * Render at most 3 items (the most relevant signals for this turn).
 * Items below WEAK threshold are omitted — the engine already filters them.
 */
export function formatSocialContextBlock(context: SocialContext): string {
  const lines: string[] = [];

  for (const item of context.items.slice(0, 3)) {
    if (item.relevance < RELEVANCE_THRESHOLDS.WEAK) continue;
    lines.push(`- ${item.reason}.`);
  }

  if (lines.length === 0) {
    return "";
  }

  const header = "CURRENT SOCIAL CONTEXT";
  return `\n[${header}]\n${lines.join("\n")}\n[/${header}]\n`;
}
