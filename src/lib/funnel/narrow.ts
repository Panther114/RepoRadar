import { embedBatch, cosineSimilarity } from "@/lib/embeddings/embedder";
import { clamp01 } from "@/lib/scoring/rubric";
import { debugTrace, searchDebugEnabled } from "@/lib/pipeline/debugTrace";
import { bm25Scores } from "@/lib/search/lexical";
import { crossEncoderEnabled, crossEncoderScores } from "@/lib/funnel/rerank";
import type { Candidate, Constraints, Intent, LightRepoEvidence } from "@/lib/types";

/** 1-based dense rank for each index (1 = highest score). Ties broken by index. */
function rankIndices(scores: number[]): number[] {
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const rank = new Array<number>(scores.length);
  order.forEach((o, pos) => { rank[o.i] = pos + 1; });
  return rank;
}

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

/**
 * Authority/prominence prior, used ONLY in the cross-encoder blend. Unlike
 * `credibilityScore` (which saturates by ~500★ to protect hidden gems), this is
 * a NON-saturating log term that still separates a 149★ demo (~0.44) from a
 * 31k★ canonical project (~0.90). The cross-encoder rewards surface text and
 * will otherwise rank a keyword-perfect demo above the real project; this is the
 * authority co-signal that prevents that burying. Neutral when the user
 * explicitly wants small/underrated repos.
 */
function prominenceScore(stars: number, includeSmall: boolean): number {
  if (includeSmall) return 0.8;
  return clamp01(Math.log10(Math.max(stars, 0) + 1) / 5);
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
    intent.anchorText ?? "",
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
  hydeDoc?: string | null,
  curatedNames?: Set<string>,
): Promise<FunnelResult> {
  const c = intent.constraints;
  // Curated membership (v1.1.4) is recorded for debug traces only. An earlier
  // cut added it as a flat +0.04 ranking boost; with cross-encoder scores
  // clustered in a narrow band that was enough to leapfrog small curated-list
  // repos over canonical projects that the mined list didn't happen to link
  // (salvo/ohkami above actix/Rocket/warp). Curation earns a repo its POOL
  // slot via injection — relevance and authority decide the rank.
  const isCurated = (candidate: Candidate): boolean =>
    curatedNames?.has(candidate.fullName.toLowerCase()) ?? false;
  const candTexts = candidates.map((candidate) => candidateText(candidate, lightEvidence?.get(candidate.githubId)));

  // Aspect-decomposed ranking: when the LLM produced ≥2 orthogonal aspects we
  // embed each one separately and combine conjunctively, so a repo must satisfy
  // EVERY facet. With <2 aspects (heuristic fallback) we use the single whole-
  // prompt vector. Everything is embedded in ONE batched ONNX call.
  const aspects = (c.aspects ?? []).map((a) => a.trim()).filter(Boolean);
  const useAspects = aspects.length >= 2;

  // Layout of the batched embedding call:
  //   [0]                    = whole-prompt intent vector
  //   [1]                    = HyDE hypothetical-doc vector (optional)
  //   [2 .. 2+A)             = one vector per aspect
  //   [2+A .. end)           = one vector per candidate
  const wholeIntentText = intent.normalizedPrompt + ". " + intentText(intent);
  const hyde = hydeDoc?.trim() || null;
  const allTexts = [wholeIntentText, hyde ?? "", ...aspects, ...candTexts];
  const embeddings = await embedBatch(allTexts);

  // HyDE: shift the whole-prompt query vector toward repo-vocabulary space by
  // averaging it with the hypothetical-doc vector. cosineSimilarity normalises,
  // so a plain average is a valid midpoint query representation.
  const promptEmbedding = embeddings[0];
  const hydeEmbedding = embeddings[1];
  const intentEmbedding =
    hyde
      ? promptEmbedding.map((v, i) => (v + hydeEmbedding[i]) / 2)
      : promptEmbedding;
  const aspectEmbeddings = embeddings.slice(2, 2 + aspects.length);
  const candEmbeddings = embeddings.slice(2 + aspects.length);

  // Pass 1: dense semantic similarity per candidate.
  const sims = candidates.map((_candidate, i) => {
    const candEmb = candEmbeddings[i];
    const wholeSim = clamp01((cosineSimilarity(intentEmbedding, candEmb) + 1) / 2);
    let similarity: number;
    let aspectSims: number[] = [];
    if (useAspects) {
      aspectSims = aspectEmbeddings.map((ae) => clamp01((cosineSimilarity(ae, candEmb) + 1) / 2));
      similarity = clamp01(0.7 * conjunctiveSim(aspectSims) + 0.3 * wholeSim);
    } else {
      similarity = wholeSim;
    }
    return { similarity, aspectSims, wholeSim };
  });

  // Hybrid retrieval (R1): fuse the dense ranking with a local BM25 lexical
  // ranking via Reciprocal Rank Fusion (k=60, score-agnostic). This restores
  // exact rare-term precision (library names) the embedding band compresses
  // away, without hurting semantic matches. Flag-gated; off = pure dense.
  const hybrid = String(process.env.HYBRID_FUNNEL ?? "").toLowerCase() === "true";
  const relevance = sims.map((s) => s.similarity);
  if (hybrid) {
    const queryTerms = [intent.normalizedPrompt, ...c.keywords, ...aspects];
    const bm25 = bm25Scores(candidates, queryTerms, lightEvidence);
    const denseRank = rankIndices(candidates.map((_, i) => sims[i].similarity));
    const lexRank = rankIndices(candidates.map((cand) => bm25.get(cand.githubId) ?? 0));
    const RRF_K = 60;
    const rrf = candidates.map((_, i) => 1 / (RRF_K + denseRank[i]) + 1 / (RRF_K + lexRank[i]));
    const maxRrf = Math.max(...rrf, 1e-9);
    for (let i = 0; i < candidates.length; i++) relevance[i] = clamp01(rrf[i] / maxRrf);
  }

  const debugRows: Record<string, unknown>[] = [];
  const entries: FunnelEntry[] = candidates.map((candidate, i) => {
    const similarity = sims[i].similarity;

    if (searchDebugEnabled()) {
      debugRows.push({
        repo: candidate.fullName,
        stars: candidate.stars,
        wholeSim: Number(sims[i].wholeSim.toFixed(4)),
        aspectSims: sims[i].aspectSims.map((s) => Number(s.toFixed(4))),
        worstAspect: sims[i].aspectSims.length ? Number(Math.min(...sims[i].aspectSims).toFixed(4)) : null,
        similarity: Number(similarity.toFixed(4)),
        relevance: Number(relevance[i].toFixed(4)),
        curated: isCurated(candidate),
      });
    }

    const prefilterScore = clamp01(
      // The relevance term (dense, or dense+lexical RRF when hybrid) is the
      // strongest gate; keep stars bias low so popular-but-irrelevant repos don't
      // crowd out closer matches. The credibility term is the floor that keeps
      // 0-star keyword-stuffed names out without penalising hidden-gem repos.
      0.68 * relevance[i] +
        0.10 * recencyScore(candidate.pushedAt, c.pushedWithinDays) +
        0.06 * licenseScore(candidate.licenseSpdx, c.licenses) +
        0.16 * credibilityScore(candidate.stars, candidate.forks, c.includeSmallProjects),
    );
    return { candidate, similarity, prefilterScore, intentEmbedding };
  });

  entries.sort((a, b) => b.prefilterScore - a.prefilterScore);

  // Cross-encoder rerank (R3): the bi-encoder funnel ranks query and repo by
  // independent embeddings; a cross-encoder reads the (query, repo) pair jointly
  // for far sharper relevance. We rerank only a shortlist (≈3×topN) of the
  // funnel's best — cheap, and enough to pull canonical answers the widened pool
  // out-ranked back to the top. The blend keeps the cross-encoder dominant for
  // relevance, but pairs it with a non-saturating prominence term (the authority
  // co-signal) plus the credibility floor — so it cannot bury a 31k★ canonical
  // project (qdrant) under a keyword-perfect 149★ demo, nor resurrect 0-signal
  // keyword matches.
  if (crossEncoderEnabled() && entries.length > topN) {
    const shortlistN = Math.min(Math.max(3 * topN, topN + 5), entries.length);
    const shortlist = entries.slice(0, shortlistN);
    const textByName = new Map(candidates.map((cand, i) => [cand.fullName, candTexts[i]]));
    try {
      const ceScores = await crossEncoderScores(
        intent.normalizedPrompt,
        shortlist.map((e) => textByName.get(e.candidate.fullName) ?? e.candidate.fullName),
      );
      shortlist.forEach((e, i) => {
        e.prefilterScore = clamp01(
          0.60 * ceScores[i] +
            0.20 * prominenceScore(e.candidate.stars, c.includeSmallProjects) +
            0.12 * credibilityScore(e.candidate.stars, e.candidate.forks, c.includeSmallProjects) +
            0.08 * recencyScore(e.candidate.pushedAt, c.pushedWithinDays),
        );
      });
      shortlist.sort((a, b) => b.prefilterScore - a.prefilterScore);
      entries.splice(0, shortlistN, ...shortlist);
    } catch {
      /* reranker unavailable → keep bi-encoder order */
    }
  }

  // MMR diversification (R4): greedily build the survivor set trading relevance
  // (prefilterScore) against novelty (1 − max cosine to already-selected), so the
  // shortlist isn't 15 near-identical forks of one project. λ keeps relevance
  // dominant. Flag-gated; off = plain top-N by prefilter.
  let selected: FunnelEntry[];
  if (String(process.env.MMR_DIVERSIFY ?? "").toLowerCase() === "true" && entries.length > topN) {
    const embByName = new Map(candidates.map((cand, i) => [cand.fullName, candEmbeddings[i]]));
    const lambda = Number(process.env.MMR_LAMBDA) || 0.7;
    const pool = [...entries];
    selected = [pool.shift()!];
    while (selected.length < topN && pool.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const emb = embByName.get(pool[i].candidate.fullName)!;
        let maxSim = 0;
        for (const s of selected) {
          const sEmb = embByName.get(s.candidate.fullName)!;
          maxSim = Math.max(maxSim, clamp01((cosineSimilarity(emb, sEmb) + 1) / 2));
        }
        const mmr = lambda * pool[i].prefilterScore - (1 - lambda) * maxSim;
        if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
      }
      selected.push(pool.splice(bestIdx, 1)[0]);
    }
  } else {
    selected = entries.slice(0, topN);
  }
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
