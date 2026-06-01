import { embed, embedBatch, cosineSimilarity } from "@/lib/embeddings/embedder";
import { clamp01 } from "@/lib/scoring/rubric";
import type { Candidate, Constraints, Intent } from "@/lib/types";

export interface FunnelEntry {
  candidate: Candidate;
  similarity: number; // cosine(intent, evidence) in 0..1
  prefilterScore: number; // blended narrowing score
  intentEmbedding: number[];
}

export interface FunnelResult {
  intentEmbedding: number[];
  entries: FunnelEntry[]; // top-N survivors, ranked
}

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400_000;
}

function recencyScore(pushedAt: string | null, pushedWithinDays: number | null): number {
  const d = daysSince(pushedAt);
  if (pushedWithinDays) return d <= pushedWithinDays ? 1 : 0.2;
  if (d < 30) return 1;
  if (d < 90) return 0.8;
  if (d < 180) return 0.6;
  if (d < 365) return 0.4;
  return 0.2;
}

function licenseScore(spdx: string | null, licenses: string[]): number {
  if (licenses.length === 0) return 1;
  if (!spdx) return 0.3;
  const norm = spdx.toLowerCase();
  return licenses.some((l) => l.toLowerCase() === norm) ? 1 : 0.3;
}

function starsScore(stars: number, includeSmall: boolean): number {
  if (includeSmall) return 1; // don't penalize small repos
  if (stars >= 500) return 1;
  if (stars >= 100) return 0.8;
  if (stars >= 20) return 0.6;
  return 0.4;
}

function candidateText(c: Candidate): string {
  return [c.fullName, c.description ?? "", c.topics.join(" "), c.primaryLanguage ?? ""]
    .join(". ")
    .slice(0, 2000);
}

function intentText(intent: Intent): string {
  const c = intent.constraints;
  return [
    intent.normalizedPrompt,
    c.keywords.join(" "),
    c.requiredFeatures.join(" "),
    c.language ?? "",
  ]
    .filter(Boolean)
    .join(". ");
}

/**
 * Deterministic narrowing funnel (NOT scoring): rank the candidate pool by a
 * blend of local-embedding similarity and cheap signals, then keep the top N.
 * This is the cost gate before deep enrichment + AI scoring.
 */
export async function narrowCandidates(
  candidates: Candidate[],
  intent: Intent,
  topN: number,
): Promise<FunnelResult> {
  const c = intent.constraints;
  const candTexts = candidates.map(candidateText);

  // Embed intent + all candidates in a single batched ONNX call
  const allTexts = [intent.normalizedPrompt + ". " + intentText(intent), ...candTexts];
  const [intentEmbedding, ...candEmbeddings] = await embedBatch(allTexts);

  const entries: FunnelEntry[] = candidates.map((candidate, i) => {
    const similarity = clamp01((cosineSimilarity(intentEmbedding, candEmbeddings[i]) + 1) / 2);
    const prefilterScore = clamp01(
      // Amplify semantic similarity — it's the strongest relevance gate we have.
      // Reduce stars bias so popular-but-irrelevant repos don't crowd out
      // semantically closer matches during funnel narrowing.
      0.80 * similarity +
        0.11 * recencyScore(candidate.pushedAt, c.pushedWithinDays) +
        0.06 * licenseScore(candidate.licenseSpdx, c.licenses) +
        0.03 * starsScore(candidate.stars, c.includeSmallProjects),
    );
    return { candidate, similarity, prefilterScore, intentEmbedding };
  });

  entries.sort((a, b) => b.prefilterScore - a.prefilterScore);

  return { intentEmbedding, entries: entries.slice(0, topN) };
}

