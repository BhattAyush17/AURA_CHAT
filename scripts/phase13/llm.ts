import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface LlmHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export function resolveOpenRouterKey(): string {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv) return fromEnv;
  for (const f of [".env.local", ".env"]) {
    const p = join(process.cwd(), f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^(?:VITE_)?OPENROUTER_API_KEY=([^\s]+)/);
      if (m) return m[1];
    }
  }
  throw new Error("No OPENROUTER_API_KEY found. Set it in env or .env.local to run Phase 13B.");
}

export async function callLlm(
  executivePrompt: string,
  history: LlmHistoryEntry[],
  userText: string,
  budgetWords: number,
): Promise<string> {
  const model = process.env.PHASE13_MODEL ?? "deepseek/deepseek-chat";
  const messages = [
    { role: "system", content: executivePrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userText },
  ];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolveOpenRouterKey()}`,
      "Content-Type": "application/json",
      "X-Title": "AURA Phase13 End-to-End Stress Test",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: Math.max(80, Math.ceil(budgetWords * 3)),
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`LLM returned empty content: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return content;
}
