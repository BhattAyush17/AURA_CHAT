#!/usr/bin/env node
/**
 * AURA Phase 13 — conversation replay viewer server.
 *
 * Zero-dependency static + API server:
 *   node tools/conversation-replay/server.mjs [--port 4173] [--runs ../runs]
 *
 * Serves:
 *   /                 → the step-through viewer (index.html)
 *   /api/runs         → [{date, dirs:[...]}] listing of runs/
 *   /api/run/:path    → raw JSON of a run artifact (conversation.json)
 */

import { createServer } from "http";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname, normalize, sep } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4173;
const RUNS_ARG =
  process.argv.indexOf("--runs") >= 0
    ? process.argv[process.argv.indexOf("--runs") + 1]
    : undefined;
const RUNS = normalize(RUNS_ARG ? join(process.cwd(), RUNS_ARG) : join(ROOT, "../../runs"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function safeJoin(base, target) {
  const full = normalize(join(base, target));
  if (!full.startsWith(base)) throw new Error("bad path");
  return full;
}

function listRuns() {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((d) => statSync(join(RUNS, d)).isDirectory())
    .sort()
    .reverse()
    .map((date) => ({
      date,
      conversations: readdirSync(join(RUNS, date))
        .filter((d) => statSync(join(RUNS, date, d)).isDirectory())
        .sort(),
    }));
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/runs") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(listRuns()));
      return;
    }
    if (path.startsWith("/api/run/")) {
      const rel = path.slice("/api/run/".length).replace(/\/+/g, "/");
      const file = safeJoin(RUNS, rel);
      if (!existsSync(file) || !file.endsWith(".json")) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(readFileSync(file, "utf8"));
      return;
    }

    const file = path === "/" ? join(ROOT, "index.html") : safeJoin(ROOT, path.slice(1));
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    res.writeHead(400);
    res.end(String(e));
  }
});

server.listen(PORT, () => {
  console.log(`AURA replay viewer → http://localhost:${PORT}`);
  console.log(`Reading runs from ${RUNS}`);
});
