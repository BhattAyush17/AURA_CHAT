/** Shared types for the OpenRouter voice pipeline. */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
