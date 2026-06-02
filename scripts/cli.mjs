#!/usr/bin/env node
/**
 * RepoRadar debug CLI — hits the local dev server at http://localhost:2000
 *
 * Usage:
 *   node scripts/cli.mjs health
 *   node scripts/cli.mjs search "TypeScript HTTP client with retry"
 *   node scripts/cli.mjs status <searchId>
 *   node scripts/cli.mjs results <searchId>
 *   node scripts/cli.mjs jobs
 */

const BASE = process.env.REPORADAR_URL ?? "http://localhost:2000";

const [, , cmd, ...args] = process.argv;

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get(path) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`);
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { body });
      return body;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function post(path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { body });
  return body;
}

async function poll(searchId, intervalMs = 2000) {
  process.stdout.write(`Polling search ${searchId}`);
  while (true) {
    const data = await get(`/api/search/${searchId}`);
    const status = data.job?.status ?? data.status ?? "unknown";
    const stage = data.job?.stage ?? "";
    const progress = data.job?.progress ?? null;
    process.stdout.write(
      `\r  [${status}] ${stage}${progress !== null ? ` (${progress}%)` : ""}          `
    );
    if (status === "completed" || status === "failed") {
      process.stdout.write("\n");
      return data;
    }
    await sleep(intervalMs);
  }
}

const commands = {
  async health() {
    const data = await get("/api/health");
    console.log("\n=== Health ===");
    print(data);
    if (!data.db) console.error("  WARNING: database not connected");
    if (!data.pgvector) console.error("  WARNING: pgvector extension not found");
  },

  async search() {
    const query = args.join(" ");
    if (!query) {
      console.error("Usage: cli.mjs search <query>");
      process.exit(1);
    }
    console.log(`\nSearching: "${query}"`);
    const { searchId } = await post("/api/search", { prompt: query });
    console.log(`Search ID: ${searchId}`);
    const data = await poll(searchId);
    if (data.job?.status === "failed") {
      console.error("Search failed:", data.job.error);
      process.exit(1);
    }
    const results = data.results ?? [];
    console.log(`\n=== Top ${results.length} Results ===`);
    results.slice(0, 10).forEach((r, i) => {
      const fit   = r.scores?.fit?.toFixed(2)        ?? "?";
      const fut   = r.scores?.future?.toFixed(2)     ?? "?";
      const under = r.scores?.underrated?.toFixed(2) ?? "?";
      const total = r.scores?.total?.toFixed(2)      ?? "?";
      const stars = r.metrics?.stars ?? r.repo?.stars ?? r.repo?.stargazersCount ?? "?";
      const name  = r.repo?.fullName ?? "unknown";
      console.log(`${String(i + 1).padStart(2)}. ${name}`);
      console.log(`    Fit:${fit}  Future:${fut}  Underrated:${under}  Total:${total}  ⭐${stars}`);
      if (r.repo?.description) console.log(`    ${r.repo.description}`);
    });
    console.log(`\nFull results: ${BASE}/results/${searchId}`);
  },

  async status() {
    const [searchId] = args;
    if (!searchId) {
      console.error("Usage: cli.mjs status <searchId>");
      process.exit(1);
    }
    const data = await get(`/api/search/${searchId}`);
    console.log("\n=== Search Status ===");
    print(data.job ?? data);
  },

  async results() {
    const [searchId] = args;
    if (!searchId) {
      console.error("Usage: cli.mjs results <searchId>");
      process.exit(1);
    }
    const data = await get(`/api/search/${searchId}`);
    console.log("\n=== Results ===");
    const results = data.results ?? [];
    if (results.length === 0) {
      console.log("No results yet. Job status:", data.job?.status);
    } else {
      results.forEach((r, i) => {
        const fit   = r.scores?.fit?.toFixed(2)        ?? "?";
        const fut   = r.scores?.future?.toFixed(2)     ?? "?";
        const under = r.scores?.underrated?.toFixed(2) ?? "?";
        const total = r.scores?.total?.toFixed(3)      ?? "?";
        console.log(
          `${String(i+1).padStart(2)}. ${r.repo?.fullName ?? "unknown"}  Fit:${fit} Future:${fut} Under:${under} Total:${total}`
        );
        if (r.repo?.description) console.log(`    ${r.repo.description}`);
      });
    }
  },

  async logs() {
    const { createReadStream, existsSync } = await import("fs");
    const { createInterface } = await import("readline");
    const logFile = new URL("../logs/pipeline.log", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
    const tailN = parseInt(args[0] ?? "50", 10);
    if (!existsSync(logFile)) {
      console.log(`No log file yet at: ${logFile}`);
      console.log("Run a search first.");
      return;
    }
    const { readFileSync } = await import("fs");
    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    const tail = lines.slice(-tailN);
    console.log(`\n=== Last ${tail.length} log lines (${logFile}) ===\n`);
    for (const line of tail) {
      try {
        const e = JSON.parse(line);
        const lvl = (e.level ?? "info").toUpperCase().padEnd(5);
        const dur = e.durationMs != null ? ` (${e.durationMs}ms)` : "";
        const err = e.error ? ` !! ${e.error.message}` : "";
        const data = e.data ? " " + JSON.stringify(e.data) : "";
        console.log(`${e.ts} [${lvl}] [${e.tag}] ${e.msg}${dur}${data}${err}`);
        if (e.error?.stack && args.includes("--stack")) {
          console.log(e.error.stack.split("\n").slice(1).map(l => "  " + l).join("\n"));
        }
      } catch {
        console.log(line);
      }
    }
  },

  async help() {
    console.log(`
RepoRadar Debug CLI  (server: ${BASE})

Commands:
  health                     Check DB + pgvector + LLM + server health
  search <query>             Run a search and stream live progress
  status <searchId>          Get current job status for a search
  results <searchId>         List ranked results for a completed search
  logs [n] [--stack]         Tail the last n pipeline log lines (default 50)
  help                       Show this help

Env:
  REPORADAR_URL              Override base URL (default: http://localhost:2000)
`);
  },
};

if (!cmd || !(cmd in commands)) {
  if (cmd) console.error(`Unknown command: ${cmd}\n`);
  await commands.help();
  process.exit(cmd ? 1 : 0);
}

try {
  await commands[cmd]();
} catch (err) {
  console.error(`\nError: ${err.message}`);
  if (err.body) print(err.body);
  process.exit(1);
}
