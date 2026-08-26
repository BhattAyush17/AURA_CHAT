import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ConversationRun, TurnRecord } from "./runner";
import type { DatasetTurn } from "./types";

export function runDir(date: string, datasetId: string): string {
  return join(process.cwd(), "runs", date, datasetId);
}

export function ensureRunDir(date: string, datasetId: string): string {
  const dir = runDir(date, datasetId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeArtifacts(run: ConversationRun, date: string) {
  const dir = ensureRunDir(date, run.dataset.id);
  writeFileSync(join(dir, "conversation.json"), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, "conversation.md"), renderConversationMd(run));
  const telemetry = run.turns.flatMap((t) =>
    t.telemetryEvents ? [{ turn: t.turn, events: t.telemetryEvents }] : [],
  );
  writeFileSync(
    join(dir, "telemetry.json"),
    JSON.stringify({ dataset: run.dataset.id, telemetry }, null, 2),
  );
  const metrics = run.turns.map((t) => ({
    turn: t.turn,
    strategy: t.executive.strategy,
    fidelity: t.fidelity?.percent ?? null,
    human: t.human?.score ?? null,
    feelsHuman: t.human?.feelsHuman ?? null,
    pipelineMs: t.pipelineMs,
    llmWords: t.llm ? t.llm.split(/\s+/).length : null,
  }));
  writeFileSync(
    join(dir, "metrics.json"),
    JSON.stringify({ dataset: run.dataset.id, stats: run.stats, metrics }, null, 2),
  );
  writeFileSync(join(dir, "report.md"), renderReportMd(run));
  return dir;
}

export function renderTurnBlock(r: TurnRecord): string {
  const lines: string[] = [];
  lines.push("────────────────────");
  lines.push(`TURN ${r.turn}`);
  lines.push("────────────────────");
  lines.push(`USER "${r.userText}"`);
  lines.push(
    `PERCEPTION confidence ${r.perception.sttConfidence}${r.perception.interruption ? " | INTERRUPTION" : ""}${r.perception.silenceMs > 0 ? ` | silence ${r.perception.silenceMs}ms` : ""} | tags [${r.perception.tags.join(",")}]`,
  );
  lines.push(
    `UNDERSTANDING move ${r.understanding.move} | goal ${r.understanding.goal} | implicit ${r.understanding.implicit ?? "none"} | expected ${r.understanding.expected} | social [${r.understanding.social.join(",")}]`,
  );
  lines.push(`SWM ${r.swm.length ? r.swm.join(", ") : "none"}`);
  lines.push(
    `MEMORY policy ${r.memory.policy} | retrieved ${r.memory.retrieved} | injected ${r.memory.injected} | referenced ${r.memory.referenced ? "YES" : "NO"}`,
  );
  lines.push(`RELATIONSHIP ${r.relationship}`);
  lines.push(
    `REFLECTION ${r.reflection.adaptations.length ? "adapted: " + r.reflection.adaptations.join("; ") : "weights-unchanged"}`,
  );
  lines.push(
    `LANGUAGE ${r.language.dominant} (conf ${r.language.confidence.toFixed(2)}, stab ${r.language.stability.toFixed(2)})`,
  );
  lines.push(`REGISTER ${r.register.register} (conf ${r.register.confidence.toFixed(2)})`);
  lines.push(
    `EXECUTIVE strategy ${r.executive.strategy} | initiative ${r.executive.initiative} | budget ${r.executive.budget} | conf ${r.executive.confidence}`,
  );
  lines.push(`PROMPT ${r.promptTokens} tokens`);
  lines.push(
    `SPEECH speed ${r.speech.speed.toFixed(2)} | energy ${r.speech.energy.toFixed(2)}${r.speech.thinking ? ` | thinking "${r.speech.thinking}"` : ""}`,
  );
  if (r.llm !== null) {
    lines.push(`LLM "${r.llm.replace(/\n/g, " ")}"`);
  } else {
    lines.push("LLM (skipped in wiring mode)");
  }
  if (r.fidelity) {
    lines.push(
      `EXECUTIVE FIDELITY ${r.fidelity.percent}% (lang ${r.fidelity.language ? "✓" : "✗"} | register ${r.fidelity.register ? "✓" : "✗"} | memory ${r.fidelity.memory ? "✓" : "✗"}${r.fidelity.hallucinatedMemory ? " HALLUCINATED" : ""} | strategy ${r.fidelity.strategy ? "✓" : "✗"} | initiative ${r.fidelity.initiative ? "✓" : "✗"} | budget ${r.fidelity.budget ? "✓" : "✗"})`,
    );
  }
  if (r.human) {
    const checks = r.human.checks
      .filter((c) => c.applicable)
      .map((c) => `${c.name}${c.passed ? "✓" : "✗"}`)
      .join(" ");
    lines.push(
      `HUMAN SCORE ${r.human.score.toFixed(1)}/10 ${r.human.feelsHuman ? "FEELS HUMAN" : "NOT HUMAN"} [${checks}]`,
    );
  }
  lines.push(`PIPELINE ${r.pipelineMs}ms`);
  return lines.join("\n");
}

export function renderConversationMd(run: ConversationRun): string {
  const s = run.stats;
  const lines: string[] = [];
  lines.push(`# ${run.dataset.name} — End-to-End Run`);
  lines.push("");
  lines.push(`- Dataset: \`${run.dataset.id}\` · Model: ${run.model} · Started: ${run.startedAt}`);
  lines.push(
    `- Estimated duration: ${run.dataset.durationMinutes} min · Turns: ${run.turns.length}`,
  );
  lines.push(
    `- Interruptions: ${s.interruptions} · Repairs: ${s.repairs} · Callbacks: ${s.callbacks} · Memory used: ${s.memoryUsed}`,
  );
  lines.push(
    `- Reflection adaptations: ${s.reflectionAdaptations} · Language switches: ${s.languageSwitches} · Register changes: ${s.registerChanges}`,
  );
  lines.push(
    `- Avg Executive Fidelity: ${s.avgFidelity}% · Avg Humanity: ${s.avgHumanity.toFixed(1)} · Realism: ${s.realism.toFixed(1)}`,
  );
  lines.push(
    `- Pipeline avg: ${s.pipelineMsAvg}ms/turn · Production readiness: ${s.productionReady ? "READY" : "NOT READY"}`,
  );
  lines.push("");
  for (const r of run.turns) {
    lines.push(renderTurnBlock(r));
    lines.push("");
  }
  return lines.join("\n");
}

export function renderReportMd(run: ConversationRun): string {
  const s = run.stats;
  const lines: string[] = [];
  lines.push(`# ${run.dataset.name} — Conversation Report`);
  lines.push("");
  lines.push(
    `**Executive Fidelity: ${s.avgFidelity}%** · **Humanity: ${s.avgHumanity.toFixed(1)}/10** · **Realism: ${s.realism.toFixed(1)}/10**`,
  );
  lines.push("");
  lines.push(`| Turn | Strategy | Fidelity | Human | Feels human | Pipeline ms |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const t of run.turns) {
    lines.push(
      `| ${t.turn} | ${t.executive.strategy} | ${t.fidelity?.percent ?? "—"}% | ${t.human?.score.toFixed(1) ?? "—"} | ${t.human?.feelsHuman ? "YES" : t.human ? "NO" : "—"} | ${t.pipelineMs} |`,
    );
  }
  lines.push("");
  lines.push(`**Production readiness: ${s.productionReady ? "READY" : "NOT READY"}**`);
  lines.push("");
  const weakest = run.turns.reduce(
    (acc, t) =>
      t.fidelity && t.fidelity.percent < acc.percent
        ? { turn: t.turn, percent: t.fidelity.percent }
        : acc,
    { turn: 0, percent: 101 },
  );
  if (weakest.turn) lines.push(`Weakest turn: ${weakest.turn} (fidelity ${weakest.percent}%)`);
  return lines.join("\n");
}

export function expectedMatchFor(
  turn: DatasetTurn,
  r: TurnRecord,
): { total: number; passed: number } {
  const exp = turn.expected;
  let total = 0;
  let passed = 0;
  const check = (list: string[] | undefined, value: string) => {
    if (list && list.length) {
      total++;
      if (list.includes(value)) passed++;
    }
  };
  check(exp.move, r.understanding.move);
  check(exp.goal, r.understanding.goal);
  check(exp.strategy, r.executive.strategy);
  check(exp.initiative, r.executive.initiative);
  check(exp.register, r.register.register);
  check(exp.language, r.language.dominant);
  check(exp.memoryPolicy, r.memory.policy);
  if (exp.swm && exp.swm.length) {
    total++;
    if (exp.swm.some((s) => r.swm.includes(s))) passed++;
  }
  return { total, passed };
}
