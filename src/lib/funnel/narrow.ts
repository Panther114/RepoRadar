import { embedBatch, cosineSimilarity } from "@/lib/embeddings/embedder";
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

/** Geometric mean of values in (0,1]. Conjunctive: one low value drags it down. */
function geometricMean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let logSum = 0;
  for (const x of xs) logSum += Math.log(Math.max(x, 1e-4));
  return Math.exp(logSum / xs.length);
}

/**
 * Conjunctive similarity from per-aspect similarities. A repo must satisfy
 * EVERY aspect; a strong match on one axis cannot rescue a miss on another.
 *
 *   combined = 0.5 * worstAspect + 0.5 * geometricMean(aspects)
 *
 * The `min` term is the pure conjunction (worst-matching aspect dominates); the
 * geometric mean smooths it so two decent aspects still beat one-great/one-poor.
 * This is what stops the "Claude/Codex" platform axis from drowning out the
 * "frontend/UI" domain axis: an off-domain repo's domain aspect is low, so its
 * min collapses no matter how perfectly it matches the platform axis.
 */
function conjunctiveSim(aspectSims: number[]): number {
  if (aspectSims.length === 0) return 0;
  const min = Math.min(...aspectSims);
  const gm = geometricMean(aspectSims);
  return clamp01(0.5 * min + 0.5 * gm);
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

  // Aspect-decomposed ranking: when the LLM produced ≥2 orthogonal aspects we
  // embed each one separately and combine conjunctively, so a repo must satisfy
  // EVERY facet. With <2 aspects (heuristic fallback) we use the single whole-
  // prompt vector. Everything is embedded in ONE batched ONNX call.
  const aspects = (c.aspects ?? []).map((a) => a.trim()).filter(Boolean);
  const useAspects = aspects.length >= 2;

  // Layout of the batched embedding call:
  //   [0]                    = whole-prompt intent vector
  //   [1 .. 1+A)             = one vector per aspect
  //   [1+A .. end)           = one vector per candidate
  const wholeIntentText = intent.normalizedPrompt + ". " + intentText(intent);
  const allTexts = [wholeIntentText, ...aspects, ...candTexts];
  const embeddings = await embedBatch(allTexts);

  const intentEmbedding = embeddings[0];
  const aspectEmbeddings = embeddings.slice(1, 1 + aspects.length);
  const candEmbeddings = embeddings.slice(1 + aspects.length);

  const entries: FunnelEntry[] = candidates.map((candidate, i) => {
    const candEmb = candEmbeddings[i];
    const wholeSim = clamp01((cosineSimilarity(intentEmbedding, candEmb) + 1) / 2);

    let similarity: number;
    if (useAspects) {
      const aspectSims = aspectEmbeddings.map((ae) =>
        clamp01((cosineSimilarity(ae, candEmb) + 1) / 2),
      );
      // Blend: the conjunctive aspect match dominates (relevance), with the
      // whole-prompt vector as a smoothing prior so phrasing nuances still count.
      similarity = clamp01(0.7 * conjunctiveSim(aspectSims) + 0.3 * wholeSim);
    } else {
      similarity = wholeSim;
    }

    const prefilterScore = clamp01(
      // Semantic similarity is the strongest relevance gate; keep stars bias low
      // so popular-but-irrelevant repos don't crowd out closer matches.
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

