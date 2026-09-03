/**
 * Token estimation helpers — ESTIMATED counts only, never reported as real.
 * Heuristic: ~4 characters per token (rough BPE average). Always surfaced in
 * the UI with a "ESTIMATED" marker so it is never mistaken for provider data.
 */

import type { TokenUsage } from "./types";

export const EST_TOKEN_CHARS = 4;

export function estimateTokens(text: string | null | undefined): number {
  const len = String(text || "").trim().length;
  if (len === 0) return 0;
  return Math.max(1, Math.round(len / EST_TOKEN_CHARS));
}

export function estimateTokenUsage(
  inputText?: string | null,
  outputText?: string | null,
): TokenUsage {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);
  return {
    inputTokens,
    outputTokens,
    inputSource: inputTokens > 0 ? "ESTIMATED" : "UNAVAILABLE",
    outputSource: outputTokens > 0 ? "ESTIMATED" : "UNAVAILABLE",
  };
}

/** Status text reused by the diagnostics panels. */
export const SOURCE_LABEL: Record<TokenUsage["inputSource"], string> = {
  REPORTED: "provider-reported",
  ESTIMATED: "estimated",
  UNAVAILABLE: "unavailable",
};
