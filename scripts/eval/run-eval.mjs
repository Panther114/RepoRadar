#!/usr/bin/env node
// RepoRadar eval runner. Runs the gold set against the live pipeline, computes
// metrics, and writes a tagged report to logs/eval/. Each prompt is run
// EVAL_REPEATS times; metrics are averaged across repeats (variance reported).
//
// Env:
//   EVAL_TAG       label for this run (e.g. "baseline", "phase1-on")   default "run"
//   EVAL_REPEATS   repeats per prompt                                   default 2
//   EVAL_PROMPTS   comma substring filter on prompt text (optional)
//   REPORADAR_URL  base url                                             default http://localhost:2000
import fs from "node:fs";
import path from "node:path";
import { computeMetrics, aggregate, poolRecall } from "./metrics.mjs";

const BASE = process.env.REPORADAR_URL ?? "http://localhost:2000";
const TAG = process.env.EVAL_TAG ?? "run";
const REPEATS = Number(process.env.EVAL_REPEATS ?? 2);
const FILTER = process.env.EVAL_PROMPTS ?? "";
const ROOT = process.cwd();
const GOLD = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/eval/gold.json"), "utf8"));
const DIAG = path.join(ROOT, "logs/search-diagnostics.jsonl");

async function postJson(p, body) {
  const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
async function getJson(p) {
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(`${BASE}${p}`);
      const j = await r.json();
      if (!r.ok) throw new Error(`${p} ${r.status}`);
      return j;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}
function poolFor(searchId) {
  if (!fs.existsSync(DIAG)) return null;
  const rows = fs.readFileSync(DIAG, "utf8").split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e?.searchQueryId === searchId);
  return rows.length ? rows[rows.length - 1].candidatePool ?? null : null;
}
function diagnosticsFor(searchId) {
  if (!fs.existsSync(DIAG)) return null;
  const rows = fs.readFileSync(DIAG, "utf8").split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e?.searchQueryId === searchId);
  return rows.length ? rows[rows.length - 1] : null;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function runOnce(prompt) {
  const started = Date.now();
  const { searchId } = await postJson("/api/search", { prompt });
  let data;
  while (true) {
    data = await getJson(`/api/search/${searchId}`);
    if (data.status === "completed" || data.status === "failed") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const latency = (Date.now() - started) / 1000;
  const results = (data.results ?? []).map((r) => ({
    fullName: r.repo?.fullName ?? "",
    stars: r.metrics?.stars ?? 0,
    fit: r.scores?.fit ?? 0,
    future: r.scores?.future ?? 0,
    source: r.analysis?.source ?? "?",
  }));
  const diagnostics = diagnosticsFor(searchId);
  return { searchId, latency, results, pool: diagnostics?.candidatePool ?? poolFor(searchId), diagnostics, status: data.status };
}

async function main() {
  const items = GOLD.prompts.filter((p) => !FILTER || p.prompt.includes(FILTER));
  console.log(`EVAL tag=${TAG} repeats=${REPEATS} prompts=${items.length}`);
  const rows = [];
  const latencies = [];
  for (const item of items) {
    const repeatMetrics = [];
    const poolRecalls = [];
    let lastResults = [];
    let lastDiagnostics = null;
    const repeats = [];
    for (let r = 0; r < REPEATS; r++) {
      const run = await runOnce(item.prompt);
      latencies.push(run.latency);
      const m = computeMetrics(item, run.results);
      repeatMetrics.push(m);
      const pr = poolRecall(item, run.pool);
      if (pr) poolRecalls.push(pr.recall);
      lastResults = run.results;
       lastDiagnostics = run.diagnostics;
      repeats.push({
        repeat: r + 1,
        searchId: run.searchId,
        status: run.status,
        latency: run.latency,
        metrics: m,
        poolRecall: pr?.recall ?? null,
        poolMissing: pr?.missing ?? [],
        top: run.results.slice(0, 15).map((result) => result.fullName),
        guidanceHintIds: (run.diagnostics?.guidanceHints ?? []).map((hint) => hint.id),
        canonicalNames: run.diagnostics?.canonicalNames ?? [],
        activeQueries: run.diagnostics?.activeQueries ?? [],
      });
      process.stdout.write(`  ${item.prompt.padEnd(40)} r${r + 1} ndcg=${m.ndcg10.toFixed(2)} rec=${(m.recall15 ?? 0).toFixed(2)} trap=${m.trapLeak} junk=${m.junk} ${run.latency.toFixed(0)}s\n`);
    }
    const avg = (k) => repeatMetrics.reduce((s, m) => s + (m[k] ?? 0), 0) / repeatMetrics.length;
    rows.push({
      prompt: item.prompt, field: item.field, type: item.type,
      ndcg10: avg("ndcg10"), recall15: avg("recall15"), mustRecall: avg("mustRecall"),
      mrr: avg("mrr"), trapLeak: avg("trapLeak"), junk: avg("junk"), allRelevant: avg("allRelevant"),
      poolRecall: poolRecalls.length ? poolRecalls.reduce((s, v) => s + v, 0) / poolRecalls.length : null,
      ndcgRange: [Math.min(...repeatMetrics.map((m) => m.ndcg10)), Math.max(...repeatMetrics.map((m) => m.ndcg10))],
      guidanceHintIds: Array.from(new Set(repeats.flatMap((repeat) => repeat.guidanceHintIds))),
      guided: repeats.some((repeat) => repeat.guidanceHintIds.length > 0),
      canonicalNames: lastDiagnostics?.canonicalNames ?? [],
      top: lastResults.slice(0, 15).map((r) => r.fullName),
      repeats,
    });
  }
  const agg = aggregate(rows);
  const poolRows = rows.map((r) => r.poolRecall).filter((v) => v != null);
  agg.poolRecall = poolRows.length ? poolRows.reduce((s, v, _, a) => s + v / a.length, 0) : null;
  agg.latencyP50 = median(latencies);
  agg.latencyP95 = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] ?? Math.max(...latencies);

  const out = { tag: TAG, generatedAt: new Date().toISOString(), repeats: REPEATS, flags: capturedFlags(), aggregate: agg, rows };
  fs.mkdirSync(path.join(ROOT, "logs/eval"), { recursive: true });
  const file = path.join(ROOT, "logs/eval", `${TAG}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("\n=== AGGREGATE (" + TAG + ") ===");
  console.log(`nDCG@10=${agg.ndcg10.toFixed(3)}  Recall@15=${agg.recall15.toFixed(3)}  PoolRecall=${agg.poolRecall.toFixed(3)}  MRR=${agg.mrr.toFixed(3)}`);
  console.log(`AllRelevant=${agg.allRelevant.toFixed(2)}  TrapLeak=${agg.trapLeak.toFixed(2)}  Junk=${agg.junk.toFixed(2)}  Latency p50=${agg.latencyP50.toFixed(0)}s p95=${agg.latencyP95.toFixed(0)}s`);
  console.log(`saved -> ${file}`);
}

function capturedFlags() {
  const keys = ["MAX_CANDIDATES", "FUNNEL_TOP_N", "RESULT_RELEVANCE_FLOOR", "SEARCH_SORT_VARIANTS", "HYBRID_FUNNEL", "HYDE", "GRAPH_TOPICS", "MMR_DIVERSIFY", "CROSS_ENCODER_RERANK", "GITHUB_PER_PAGE"];
  const o = {};
  for (const k of keys) if (process.env[k] != null) o[k] = process.env[k];
  return o;
}

main().catch((e) => { console.error(e); process.exit(1); });
