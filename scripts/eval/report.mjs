#!/usr/bin/env node
// Diff two eval runs. Usage: node scripts/eval/report.mjs <controlTag> <candidateTag>
import fs from "node:fs";
import path from "node:path";

const [ctrl, cand] = process.argv.slice(2);
if (!ctrl || !cand) { console.error("usage: report.mjs <controlTag> <candidateTag>"); process.exit(1); }
const load = (t) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "logs/eval", `${t}.json`), "utf8"));
const A = load(ctrl), B = load(cand);

const metrics = [
  ["nDCG@10", "ndcg10", 3, +1],
  ["Recall@15", "recall15", 3, +1],
  ["PoolRecall", "poolRecall", 3, +1],
  ["MRR", "mrr", 3, +1],
  ["AllRelevant", "allRelevant", 2, +1],
  ["TrapLeak", "trapLeak", 2, -1],
  ["Junk", "junk", 2, -1],
  ["Latency p50", "latencyP50", 0, -1],
  ["Latency p95", "latencyP95", 0, -1],
];

console.log(`\nCONTROL  = ${ctrl}   flags=${JSON.stringify(A.flags)}`);
console.log(`CANDIDATE= ${cand}   flags=${JSON.stringify(B.flags)}\n`);
console.log("metric".padEnd(14), "control".padStart(9), "cand".padStart(9), "delta".padStart(9), "  verdict");
console.log("-".repeat(60));
for (const [label, key, dp, dir] of metrics) {
  const a = A.aggregate[key], b = B.aggregate[key];
  if (a == null || b == null) continue;
  const d = b - a;
  const good = dir > 0 ? d > 0 : d < 0;
  const flat = Math.abs(d) < (key.startsWith("latency") ? 2 : 0.005);
  const verdict = flat ? "≈" : good ? "✓ better" : "✗ worse";
  console.log(label.padEnd(14), a.toFixed(dp).padStart(9), b.toFixed(dp).padStart(9), (d >= 0 ? "+" : "") + d.toFixed(dp).padStart(8), "  " + verdict);
}

// Per-prompt nDCG deltas
console.log("\nper-prompt nDCG@10 (control -> cand):");
const byPrompt = Object.fromEntries(A.rows.map((r) => [r.prompt, r]));
for (const rb of B.rows) {
  const ra = byPrompt[rb.prompt];
  if (!ra) continue;
  const d = rb.ndcg10 - ra.ndcg10;
  const mark = Math.abs(d) < 0.02 ? " " : d > 0 ? "↑" : "↓";
  console.log(`  ${mark} ${rb.prompt.padEnd(42)} ${ra.ndcg10.toFixed(2)} -> ${rb.ndcg10.toFixed(2)}  (${d >= 0 ? "+" : ""}${d.toFixed(2)})  poolRec ${ra.poolRecall?.toFixed(2) ?? "?"}->${rb.poolRecall?.toFixed(2) ?? "?"}`);
}
