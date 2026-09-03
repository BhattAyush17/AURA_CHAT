/**
 * formatAutonomousBlock — renders an AutonomousConversationDecision into a
 * compact, prompt-safe "[AUTONOMOUS CONVERSATION]" block.
 *
 * ANTI-LEAK CONTRACT:
 *  - NEVER emit initiativeScore, confidence, rawSignals, signal names,
 *    controller/flag identifiers, or any internal decision metadata here.
 *  - The rendered block is natural-language guidance only, so an LLM cannot
 *    echo internal machinery back to the user.
 *  - This block is appended to the SAME cognitive string every provider sends,
 *    so OpenRouter, Sarvam and Gemini receive identical autonomous guidance.
 */

import type { AutonomousConversationDecision } from "./types";

export function formatAutonomousBlock(decision: AutonomousConversationDecision): string {
  const lines: string[] = [];

  if (!decision.shouldSpeak) {
    lines.push("Hold the floor naturally. You do not need to fill the silence with speech.");
  } else {
    lines.push(
      `You may speak naturally: ${decision.responseGuidance ?? "respond to what was said."}`,
    );
  }

  if (decision.topicContinuation && decision.shouldSpeak) {
    lines.push(`If it feels natural, ${decision.topicContinuation}.`);
  }

  if (decision.memoryOpportunity && decision.shouldSpeak) {
    lines.push("If it feels true, you may gently work in something you remember about the user.");
  }

  lines.push("Remain fully natural and in character; never refer to how you reached a decision.");

  return `\n[AUTONOMOUS CONVERSATION]\n${lines.join("\n")}\n[/AUTONOMOUS CONVERSATION]\n`;
}
