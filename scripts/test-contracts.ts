import { MemoryWriteRequestSchema } from "../src/lib/contracts/memory";

const ok = MemoryWriteRequestSchema.safeParse({
  text: "Bhai, aaj ka din kaafi stressful tha yaar.",
  user_id: "user_42",
  session_id: "sess_abc",
  memory_mode: "supabase",
  emotional_state: { tension: 0.8, energy: 0.2, vulnerability: 0.6 },
  client_memories: [{ content: "old thing" }],
});
console.log("VALID:", ok.ok, ok.ok ? "→ accepted" : ok.errors);

const badCases: Array<[string, unknown]> = [
  ["message-instead-of-text", { message: "hi", user_id: "u" }],
  ["empty-text", { text: "   ", user_id: "u" }],
  ["missing-user", { text: "hi" }],
  ["too-long-text", { text: "x".repeat(2001), user_id: "u" }],
  ["bad-mode", { text: "hi", user_id: "u", memory_mode: "cloud" }],
  ["nan-emotion", { text: "hi", user_id: "u", emotional_state: { tension: "hot" } }],
  ["too-many-memories", { text: "hi", user_id: "u", client_memories: new Array(6).fill({}) }],
];

let strict = true;
for (const [name, payload] of badCases) {
  const r = MemoryWriteRequestSchema.safeParse(payload);
  const rejected = !r.ok;
  console.log(
    `REJECT ${name}: ${rejected ? "OK" : "FAIL — was accepted"} ${rejected ? r.errors.join("; ") : ""}`,
  );
  if (!rejected) strict = false;
}

process.exit(ok.ok && strict ? 0 : 1);
