import type { Candidate, LightRepoEvidence } from "@/lib/types";

/**
 * Local BM25 over the candidate pool. The dense funnel under-weights exact rare
 * terms (library names like "rocket", "axum"); a lexical signal fused with the
 * embedding signal (via RRF in the funnel) restores precision for named and
 * keyword-precise queries without a new service — this all runs in-process over
 * the ≤MAX_CANDIDATES pool we already hold.
 */

const STOP = new Set([
  "the", "a", "an", "for", "and", "or", "to", "of", "in", "on", "with", "is",
  "are", "be", "library", "framework", "tool", "app", "open", "source",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Field-weighted document text: name/topics count more than README body. */
function docText(c: Candidate, light?: LightRepoEvidence): string {
  // Repeat high-signal fields so BM25 term frequency reflects field importance.
  const name = c.fullName.replace(/[/_-]/g, " ");
  const topics = c.topics.join(" ");
  return [
    name, name, // name weight ×2
    c.description ?? "",
    topics, topics, // topics weight ×2
    light?.manifestNames?.join(" ") ?? "",
    light?.readmeHead ?? "",
  ].join(" ");
}

/**
 * Returns a Map githubId -> BM25 score (raw, unnormalised). Caller can rank.
 */
export function bm25Scores(
  candidates: Candidate[],
  queryTerms: string[],
  lightEvidence?: Map<number, LightRepoEvidence>,
): Map<number, number> {
  const k1 = 1.5;
  const b = 0.75;
  const docs = candidates.map((c) => tokenize(docText(c, lightEvidence?.get(c.githubId))));
  const N = docs.length || 1;
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N || 1;

  // Document frequency per term.
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const qterms = Array.from(new Set(queryTerms.flatMap((t) => tokenize(t))));
  const out = new Map<number, number>();

  candidates.forEach((c, i) => {
    const d = docs[i];
    const dl = d.length || 1;
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const q of qterms) {
      const f = tf.get(q);
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
    }
    out.set(c.githubId, score);
  });
  return out;
}
