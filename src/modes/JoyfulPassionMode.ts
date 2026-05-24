// src/modes/JoyfulPassionMode.ts
// SAFE PUBLIC VERSION — Explicit prompt injected via VITE_EXPLICIT_PROMPT env var at build time.
// The actual prompt lives in .env.local (gitignored) and is never committed to source control.

export const isJoyfulPassionMode = true;

export const SECRET_ACTIVATION_PHRASE = "boundless-sexuality";

/**
 * The explicit system prompt is loaded from the VITE_EXPLICIT_PROMPT environment variable.
 * - Local dev: set in .env.local (gitignored)
 * - Production: set in Vercel/Render dashboard → Environment Variables
 * - Fallback: safe friendly mode if env var is missing
 */
export const JoyfulPassionSystemPrompt: string =
  import.meta.env.VITE_EXPLICIT_PROMPT ||
  "You are a friendly, helpful companion. Stay respectful and supportive.";

/**
 * Runtime check: returns true only if the real explicit prompt was injected.
 * Useful for conditional UI or logging.
 */
export const isExplicitModeEnabled = (): boolean => {
  const prompt = import.meta.env.VITE_EXPLICIT_PROMPT;
  return typeof prompt === "string" && prompt.length > 100;
};