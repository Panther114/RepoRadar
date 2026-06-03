import { embedBatch, cosineSimilarity } from "@/lib/embeddings/embedder";
import { clamp01 } from "@/lib/scoring/rubric";
import { debugTrace, searchDebugEnabled } from "@/lib/pipeline/debugTrace";
import type { Candidate, Constraints, Intent, LightRepoEvidence } from "@/lib/types";

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

/**
 * Credibility prior: separates repos with at least SOME real-world traction from
 * 0-star personal/tutorial/homework repos whose keyword-stuffed names score high
 * embedding similarity (e.g. "End-to-End-Observability-Stack-…-in-Kubernetes")
 * yet are never the best answer. Forks count double — a forked-from-nobody repo
 * with 30 stars is more credible than a 30-star island. Saturates by ~500 stars
 * so genuine hidden gems (tens–hundreds of stars) are NOT penalised; only the
 * true 0-signal bottom is. Disabled when the user explicitly wants small repos.
 */
function credibilityScore(stars: number, forks: number, includeSmall: boolean): number {
  if (includeSmall) return 1;
  return clamp01(Math.log10(Math.max(stars, 0) + 2 * Math.max(forks, 0) + 1) / 2.2);
}

function candidateText(c: Candidate, light?: LightRepoEvidence): string {
  return [
    c.fullName,
    c.description ?? "",
    c.topics.join(" "),
    c.primaryLanguage ?? "",
    light?.manifestNames.join(" ") ?? "",
    light?.readmeHead ?? "",
  ]
    .join(". ")
    .slice(0, 1200);
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
  lightEvidence?: Map<number, LightRepoEvidence>,
  rescuedNames: string[] = [],
  debugContext?: { searchQueryId: string },
): Promise<FunnelResult> {
  const c = intent.constraints;
  const candTexts = candidates.map((candidate) => candidateText(candidate, lightEvidence?.get(candidate.githubId)));

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

  const debugRows: Record<string, unknown>[] = [];
  const entries: FunnelEntry[] = candidates.map((candidate, i) => {
    const candEmb = candEmbeddings[i];
    const wholeSim = clamp01((cosineSimilarity(intentEmbedding, candEmb) + 1) / 2);

    let similarity: number;
    let aspectSims: number[] = [];
    if (useAspects) {
      aspectSims = aspectEmbeddings.map((ae) =>
        clamp01((cosineSimilarity(ae, candEmb) + 1) / 2),
      );
      // Blend: the conjunctive aspect match dominates (relevance), with the
      // whole-prompt vector as a smoothing prior so phrasing nuances still count.
      similarity = clamp01(0.7 * conjunctiveSim(aspectSims) + 0.3 * wholeSim);
    } else {
      similarity = wholeSim;
    }

    if (searchDebugEnabled()) {
      debugRows.push({
        repo: candidate.fullName,
        stars: candidate.stars,
        wholeSim: Number(wholeSim.toFixed(4)),
        aspectSims: aspectSims.map((s) => Number(s.toFixed(4))),
        worstAspect: aspectSims.length ? Number(Math.min(...aspectSims).toFixed(4)) : null,
        similarity: Number(similarity.toFixed(4)),
      });
    }

    const prefilterScore = clamp01(
      // Semantic similarity is the strongest relevance gate; keep stars bias low
      // so popular-but-irrelevant repos don't crowd out closer matches. The
      // credibility term is the floor that keeps 0-star keyword-stuffed names
      // out of the shortlist without penalising genuine small/hidden-gem repos.
      0.68 * similarity +
        0.10 * recencyScore(candidate.pushedAt, c.pushedWithinDays) +
        0.06 * licenseScore(candidate.licenseSpdx, c.licenses) +
        0.16 * credibilityScore(candidate.stars, candidate.forks, c.includeSmallProjects),
    );
    return { candidate, similarity, prefilterScore, intentEmbedding };
  });

  entries.sort((a, b) => b.prefilterScore - a.prefilterScore);

  const selected = entries.slice(0, topN);
  const selectedNames = new Set(selected.map((entry) => entry.candidate.fullName.toLowerCase()));
  const rescued = new Set(
    rescuedNames
      .map((name) => name.trim().replace(/^https:\/\/github\.com\//i, "").toLowerCase())
      .filter((name) => name.includes("/")),
  );

  // Similarity gate for rescues. A guidance/LLM "canonical" name is only a HINT,
  // not ground truth — loose matching can suggest an off-domain popular repo
  // (e.g. a state-manager for a "data table" query). Only force-rescue a repo
  // that is at least nearly as relevant as the weakest naturally-selected
  // survivor; otherwise the rescue would displace a genuine match with noise.
  const naturalSims = selected.map((entry) => entry.similarity);
  const minNaturalSim = naturalSims.length ? Math.min(...naturalSims) : 0;
  const rescueFloor = minNaturalSim * 0.9;

  const maxRescues = Math.min(3, topN);
  let rescueCount = selected.filter((entry) => rescued.has(entry.candidate.fullName.toLowerCase())).length;
  for (const entry of entries) {
    if (rescueCount >= maxRescues) break;
    const fullName = entry.candidate.fullName.toLowerCase();
    if (!rescued.has(fullName) || selectedNames.has(fullName)) continue;
    if (entry.similarity < rescueFloor) continue; // off-domain canonical hint — skip
    if (selected.length < topN) {
      selected.push(entry);
    } else {
      let replaceAt = selected.length - 1;
      while (replaceAt >= 0 && rescued.has(selected[replaceAt].candidate.fullName.toLowerCase())) replaceAt--;
      if (replaceAt < 0) break;
      selectedNames.delete(selected[replaceAt].candidate.fullName.toLowerCase());
      selected[replaceAt] = entry;
    }
    selectedNames.add(fullName);
    rescueCount++;
  }

  selected.sort((a, b) => b.prefilterScore - a.prefilterScore);
  const finalEntries = selected.slice(0, topN);

  if (searchDebugEnabled() && debugContext) {
    const prefilterByRepo = new Map(entries.map((e) => [e.candidate.fullName, e.prefilterScore]));
    const survivorSet = new Set(finalEntries.map((e) => e.candidate.fullName));
    const ranked = [...debugRows]
      .map((row) => ({
        ...row,
        prefilterScore: Number((prefilterByRepo.get(String(row.repo)) ?? 0).toFixed(4)),
        survived: survivorSet.has(String(row.repo)),
      }))
      .sort((a, b) => (b.prefilterScore as number) - (a.prefilterScore as number));
    debugTrace("funnel", debugContext.searchQueryId, {
      poolSize: candidates.length,
      topN,
      useAspects,
      aspects,
      normalizedPrompt: intent.normalizedPrompt,
      ranked,
    });
  }

  return { intentEmbedding, entries: finalEntries };
}
