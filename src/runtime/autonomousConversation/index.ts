/**
 * AutonomousConversation — public entry point.
 *
 * Global, provider-independent. Consumed identically by OpenRouter, Sarvam
 * and Gemini through the shared cognitive block built by RuntimeManager.
 */

export * from "./types";
export {
  evaluateAutonomous,
  getAutonomousConversationEngine,
} from "./AutonomousConversationEngine";
export type { AutonomousOutcome } from "./AutonomousConversationEngine";
export { formatAutonomousBlock } from "./formatAutonomousBlock";
