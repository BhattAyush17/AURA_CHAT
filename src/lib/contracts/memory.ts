/**
 * AURA network contracts — memory write boundary (client side).
 *
 * Mirrors backend/api/contracts.py ChatRequest fields that the /chat
 * memory-write conduit consumes. The backend Pydantic model is the
 * enforcement authority; this validator catches malformed payloads on
 * the client so a bad write is never shipped silently.
 *
 * Field notes (must stay wire-compatible with backend/api/contracts.py):
 *   text  — the turn text (NOT "message"; the live contract uses "text").
 *   user_id, session_id — identity.
 *   emotional_state — optional emotion tags, persisted into write metadata.
 *   client_memories — client-side injected memories (local mode, max 5).
 *   memory_mode — "supabase" | "local".
 *   executive_plan, memory_policy, seed, cognitive_block — optional prompts.
 */

export interface MemoryWriteRequest {
  text: string;
  user_id: string;
  session_id?: string;
  memory_mode?: "supabase" | "local";
  emotional_state?: Record<string, number>;
  conversation_history?: Array<Record<string, unknown>>;
  client_memories?: Array<Record<string, unknown>>;
  executive_plan?: string;
  memory_policy?: string;
  seed?: string;
  cognitive_block?: string;
}

export type MemoryParseResult =
  | { ok: true; value: MemoryWriteRequest }
  | { ok: false; errors: string[] };

const MAX_TEXT = 2000;
const MAX_ID = 200;
const MAX_PLAN = 2000;
const MAX_SEED = 4000;
const MAX_POLICY = 20;
const MAX_CLIENT_MEMORIES = 5;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(errors: string[]): { ok: false; errors: string[] } {
  return { ok: false, errors };
}

function optString(
  input: unknown,
  field: string,
  max: number,
  value: Partial<MemoryWriteRequest>,
  errors: string[],
  target: "session_id" | "executive_plan" | "memory_policy" | "seed" | "cognitive_block",
): void {
  if (input === undefined) return;
  if (typeof input !== "string" || input.length > max) {
    errors.push(`${field} must be a string of at most ${max} chars`);
    return;
  }
  value[target] = input;
}

export const MemoryWriteRequestSchema = {
  safeParse(input: unknown): MemoryParseResult {
    if (!isRecord(input)) return fail(["payload must be an object"]);

    const value: Partial<MemoryWriteRequest> = {};
    const errors: string[] = [];

    if (
      typeof input.text !== "string" ||
      input.text.trim().length === 0 ||
      input.text.length > MAX_TEXT
    ) {
      errors.push(`text must be a non-empty string of at most ${MAX_TEXT} chars`);
    } else {
      value.text = input.text;
    }

    if (
      typeof input.user_id !== "string" ||
      input.user_id.trim().length === 0 ||
      input.user_id.length > MAX_ID
    ) {
      errors.push(`user_id must be a non-empty string of at most ${MAX_ID} chars`);
    } else {
      value.user_id = input.user_id;
    }

    optString(input.session_id, "session_id", MAX_ID, value, errors, "session_id");
    optString(input.executive_plan, "executive_plan", MAX_PLAN, value, errors, "executive_plan");
    optString(input.memory_policy, "memory_policy", MAX_POLICY, value, errors, "memory_policy");
    optString(input.seed, "seed", MAX_SEED, value, errors, "seed");
    optString(input.cognitive_block, "cognitive_block", MAX_SEED, value, errors, "cognitive_block");

    if (input.memory_mode !== undefined) {
      if (input.memory_mode !== "supabase" && input.memory_mode !== "local") {
        errors.push('memory_mode must be "supabase" or "local"');
      } else {
        value.memory_mode = input.memory_mode;
      }
    }

    if (input.emotional_state !== undefined) {
      if (!isRecord(input.emotional_state)) {
        errors.push("emotional_state must be an object of numeric tags");
      } else {
        for (const [k, v] of Object.entries(input.emotional_state)) {
          if (typeof v !== "number" || !Number.isFinite(v)) {
            errors.push(`emotional_state.${k} must be a finite number`);
            break;
          }
        }
        value.emotional_state = input.emotional_state as Record<string, number>;
      }
    }

    if (input.conversation_history !== undefined) {
      if (
        !Array.isArray(input.conversation_history) ||
        !input.conversation_history.every(isRecord)
      ) {
        errors.push("conversation_history must be an array of objects");
      } else {
        value.conversation_history = input.conversation_history as Array<Record<string, unknown>>;
      }
    }

    if (input.client_memories !== undefined) {
      if (
        !Array.isArray(input.client_memories) ||
        input.client_memories.length > MAX_CLIENT_MEMORIES ||
        !input.client_memories.every(isRecord)
      ) {
        errors.push(`client_memories must be an array of at most ${MAX_CLIENT_MEMORIES} objects`);
      } else {
        value.client_memories = input.client_memories as Array<Record<string, unknown>>;
      }
    }

    return errors.length > 0 ? fail(errors) : { ok: true, value: value as MemoryWriteRequest };
  },
};

export function validateMemoryWriteRequest(input: unknown): MemoryParseResult {
  return MemoryWriteRequestSchema.safeParse(input);
}
