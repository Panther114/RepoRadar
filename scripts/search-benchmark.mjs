#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BENCHMARK_PROMPTS = [
  { prompt: "browser testing", expected: ["playwright", "selenium", "puppeteer"] },
  { prompt: "local first sync", expected: ["yjs", "automerge", "loro", "rxdb"] },
  { prompt: "self hosted deploy", expected: ["coolify", "dokku", "caprover"] },
  { prompt: "self hosted analytics", expected: ["plausible", "umami", "matomo"], forbidden: ["coolify", "dokku", "caprover"] },
  { prompt: "python data validation", expected: ["pydantic", "jsonschema", "marshmallow"], forbidden: ["requests"] },
  { prompt: "svelte data table", expected: ["table", "grid", "datatable"], forbidden: ["zustand", "redux", "jotai"] },
  { prompt: "go web framework", expected: ["gin", "fiber", "echo"], forbidden: ["awesome", "comparison"] },
  { prompt: "ruby data validation", expected: ["dry", "validation", "active_model"], forbidden: ["requests"] },
  { prompt: "vector db embeddings", expected: ["qdrant", "weaviate", "milvus"] },
  { prompt: "firebase alternative", expected: ["supabase", "appwrite", "pocketbase"] },
];

const BASE = process.env.REPORADAR_URL ?? "http://localhost:2000";
const DIAGNOSTICS_FILE = path.join(process.cwd(), "logs", "search-diagnostics.jsonl");

export function clampBenchmarkLimit(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 6;
  return Math.min(Math.max(n, 1), 10);
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function getJson(path) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`);
      const body = await res.json();
      if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(body)}`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError;
}

async function postJson(path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function poll(searchId) {
  while (true) {
    const data = await getJson(`/api/search/${searchId}`);
    if (data.status === "completed" || data.status === "failed") return data;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function expectedPresence(results, expected) {
  const names = results.map((r) => String(r.repo?.fullName ?? "").toLowerCase());
  return expected.map((term) => ({
    term,
    found: names.some((name) => name.includes(term.toLowerCase())),
  }));
}

function forbiddenPresence(results, forbidden = []) {
  const names = results.map((r) => String(r.repo?.fullName ?? "").toLowerCase());
  return forbidden.map((term) => ({
    term,
    found: names.some((name) => name.includes(term.toLowerCase())),
  }));
}

function diagnosticsFor(searchId) {
  if (!fs.existsSync(DIAGNOSTICS_FILE)) return null;
  const matches = fs
    .readFileSync(DIAGNOSTICS_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry?.searchQueryId === searchId);

  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const canonical = last.perQueryResults?.find((entry) => entry.query === "canonical-rescue");
  return {
    generatedQueries: last.llmQueries ?? [],
    heuristicQueries: last.heuristicQueries ?? [],
    activeQueryCount: last.activeQueries?.length ?? 0,
    activeQueries: last.activeQueries ?? [],
    candidatePoolCount: last.candidatePoolCount ?? 0,
    dedupeCount: last.dedupeCount ?? 0,
    funnelSurvivors: last.funnelSurvivors ?? [],
    droppedKnownCandidates: last.droppedKnownCandidates ?? [],
    apiCallCounts: {
      githubSearch: last.activeQueries?.length ?? 0,
      canonicalRest: canonical?.total ?? 0,
      graphQlEnrichment: "bounded light + survivor batches; see pipeline log for fetched/cache counts",
    },
  };
}

async function main() {
  const limit = clampBenchmarkLimit(argValue("--limit"));
  const prompts = BENCHMARK_PROMPTS.slice(0, limit);
  const report = [];

  console.log(`RepoRadar diagnostic benchmark (${prompts.length} short prompts, no aggregate score)`);
  for (const item of prompts) {
    const started = Date.now();
    console.log(`\n> ${item.prompt}`);
    const { searchId } = await postJson("/api/search", { prompt: item.prompt });
    const result = await poll(searchId);
    const latencyMs = Date.now() - started;
    const topRepos = (result.results ?? []).slice(0, 10).map((r) => r.repo?.fullName ?? "unknown");
    const expected = expectedPresence(result.results ?? [], item.expected);
    const forbidden = forbiddenPresence(result.results ?? [], item.forbidden);
    const diagnostics = diagnosticsFor(searchId);
    const coverage = expected.filter((x) => x.found).length / Math.max(expected.length, 1);
    const leakage = forbidden.filter((x) => x.found).length;
    const score = Math.max(0, coverage - leakage * 0.25);

    const row = {
      prompt: item.prompt,
      searchId,
      status: result.status,
      latencyMs,
      score,
      generatedQueries: diagnostics?.generatedQueries ?? [],
      activeQueryCount: diagnostics?.activeQueryCount ?? null,
      apiCallCounts: diagnostics?.apiCallCounts ?? null,
      topRepos,
      expected,
      forbidden,
      candidatePoolCount: diagnostics?.candidatePoolCount ?? null,
      dedupeCount: diagnostics?.dedupeCount ?? null,
      funnelSurvivors: diagnostics?.funnelSurvivors ?? [],
      droppedKnownCandidates: diagnostics?.droppedKnownCandidates ?? [],
      diagnostics: "Raw candidate-pool details are also appended to logs/search-diagnostics.jsonl.",
      reviewNote: "Coverage score is a holdout smoke test only; inspect the top repos and diagnostics before trusting it.",
    };
    report.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  const scores = report.map((row) => row.score);
  console.log("\nJSON summary:");
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    report,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
