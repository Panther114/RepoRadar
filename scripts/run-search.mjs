#!/usr/bin/env node
// Local search runner: POST a prompt, poll to completion, print the ranked list
// with fit/future/similarity/source. Usage: node scripts/run-search.mjs "prompt"
const BASE = process.env.REPORADAR_URL ?? "http://localhost:2000";

async function postJson(p, body) {
  const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
async function getJson(p) {
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(`${BASE}${p}`);
      const j = await r.json();
      if (!r.ok) throw new Error(`${p} ${r.status}: ${JSON.stringify(j)}`);
      return j;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

const prompt = process.argv[2];
if (!prompt) { console.error("need a prompt"); process.exit(1); }

const started = Date.now();
const { searchId } = await postJson("/api/search", { prompt });
let data;
while (true) {
  data = await getJson(`/api/search/${searchId}`);
  if (data.status === "completed" || data.status === "failed") break;
  await new Promise((r) => setTimeout(r, 2000));
}
const latency = ((Date.now() - started) / 1000).toFixed(1);
const results = data.results ?? [];
console.log(`\n=== "${prompt}"  [${data.status}, ${latency}s, ${results.length} results]  id=${searchId}`);
results.forEach((r, i) => {
  const a = r.analysis ?? {};
  const repo = r.repo ?? {};
  const s = r.scores ?? {};
  const stars = r.metrics?.stars ?? 0;
  console.log(
    `${String(i + 1).padStart(2)}. ${(repo.fullName ?? "?").padEnd(42)} ` +
    `★${String(stars).padStart(7)}  fit=${(s.fit ?? 0).toFixed(2)} fut=${(s.future ?? 0).toFixed(2)} ` +
    `sim=${(a.fitComponents?.semantic_similarity ?? 0).toFixed(2)} ${a.source ?? "?"}`
  );
});
console.log(`SEARCH_ID=${searchId}`);
