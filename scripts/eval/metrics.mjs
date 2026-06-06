// Metrics for RepoRadar search-quality evaluation.
// A "result" is { fullName, stars, fit, future, source }. fullNames compared lowercased.

const lc = (s) => String(s ?? "").toLowerCase();

export function gradeOf(fullName, gold) {
  const n = lc(fullName);
  if (gold.must.has(n)) return 2;
  if (gold.nice.has(n)) return 1;
  if (gold.traps.has(n)) return -2;
  return 0;
}

function dcg(grades) {
  return grades.reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
}

/** Compute per-prompt metrics for one result list (already top-15, ranked). */
export function computeMetrics(item, results) {
  const gold = {
    must: new Set((item.must_include ?? []).map(lc)),
    nice: new Set((item.nice_to_have ?? []).map(lc)),
    traps: new Set((item.traps ?? []).map(lc)),
  };
  const names = results.map((r) => lc(r.fullName));
  const goldAll = new Set([...gold.must, ...gold.nice]);

  // Recall@15
  const foundGold = [...goldAll].filter((g) => names.includes(g));
  const recall15 = goldAll.size ? foundGold.length / goldAll.size : null;
  const mustFound = [...gold.must].filter((g) => names.includes(g)).length;
  const mustRecall = gold.must.size ? mustFound / gold.must.size : null;

  // nDCG@10 (graded, traps penalised)
  const top10 = names.slice(0, 10).map((n) => gradeOf(n, gold));
  const idealGrades = [
    ...Array(gold.must.size).fill(2),
    ...Array(gold.nice.size).fill(1),
  ].slice(0, 10);
  const idcg = dcg(idealGrades) || 1;
  const ndcg10 = Math.max(0, dcg(top10) / idcg);

  // MRR of first must hit (within 15)
  let mrr = 0;
  for (let i = 0; i < names.length; i++) {
    if (gold.must.has(names[i])) { mrr = 1 / (i + 1); break; }
  }

  // Trap leak + junk
  const trapLeak = names.filter((n) => gold.traps.has(n)).length;
  const junk = results.filter(
    (r) => (r.stars ?? 0) < 50 && (r.future ?? 1) < 0.1 && !goldAll.has(lc(r.fullName)),
  ).length;
  const allRelevant = junk === 0 && trapLeak === 0 ? 1 : 0;

  return { recall15, mustRecall, ndcg10, mrr, trapLeak, junk, allRelevant, foundGold };
}

/** Aggregate (mean) per-prompt metrics into one summary. */
export function aggregate(perPrompt) {
  const keys = ["recall15", "mustRecall", "ndcg10", "mrr", "trapLeak", "junk", "allRelevant"];
  const out = {};
  for (const k of keys) {
    const vals = perPrompt.map((p) => p[k]).filter((v) => v != null);
    out[k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }
  return out;
}

/** Pool recall: did gold repos even enter the candidate pool? Needs diagnostics.candidatePool. */
export function poolRecall(item, pool) {
  const names = new Set((pool ?? []).map(lc));
  const goldAll = [...new Set([...(item.must_include ?? []), ...(item.nice_to_have ?? [])].map(lc))];
  if (!goldAll.length) return null;
  const found = goldAll.filter((g) => names.has(g));
  return { recall: found.length / goldAll.length, missing: goldAll.filter((g) => !names.has(g)) };
}
