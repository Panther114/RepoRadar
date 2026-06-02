import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env, isLlmEnabled } from "@/lib/env";
import { LLM_MODEL } from "@/lib/llm/client";
import { extractIntent, heuristicIntent } from "@/lib/llm/intent";
import { searchCandidates } from "@/lib/github/search";
import { narrowCandidates } from "@/lib/funnel/narrow";
import { enrichReposBatch } from "@/lib/github/enrich";
import { scoreRepo } from "@/lib/llm/score";
import { deterministicScore } from "@/lib/scoring/deterministic";
import { embedBatch } from "@/lib/embeddings/embedder";
import { upsertRepoEmbedding, setIntentEmbedding } from "@/lib/embeddings/store";
import {
  upsertRepo,
  saveSnapshot,
  saveReadme,
  saveResult,
  loadEnrichmentCache,
  saveEnrichmentCache,
  loadCandidateCache,
  saveCandidateCache,
} from "@/lib/pipeline/persist";
import { analysisInputHash, hashJson, sha256 } from "@/lib/cache/keys";
import { createLogger } from "@/lib/logger";
import type { Analysis, Intent, RepoEvidence, SearchFilters } from "@/lib/types";

const log = createLogger("pipeline");

async function setJob(
  searchQueryId: string,
  patch: { status?: string; stage?: string; progress?: number; error?: string },
): Promise<void> {
  await prisma.searchJob.updateMany({ where: { searchQueryId }, data: patch });
}

const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

/** Run `worker` over `items` with at most `concurrency` tasks in flight. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) await worker(next);
      }
    }),
  );
}

async function scoreWithCache(
  intent: Intent,
  evidence: RepoEvidence,
  repoId: string,
  searchQueryId: string,
  intentHash: string,
): Promise<Analysis> {
  if (!isLlmEnabled()) {
    log.debug("LLM disabled — using deterministic scorer", { repo: evidence.candidate.fullName });
    return deterministicScore(intent, evidence);
  }

  const inputHash = analysisInputHash({
    fullName: evidence.candidate.fullName,
    pushedAt: evidence.candidate.pushedAt,
    readmeHash: evidence.readmeHash,
    intentHash,
    model: LLM_MODEL,
  });

  const cached = await prisma.modelAnalysis.findUnique({ where: { inputHash } });
  if (cached) {
    log.debug("Cache hit for analysis", { repo: evidence.candidate.fullName, inputHash });
    return cached.outputJson as unknown as Analysis;
  }

  log.info("Calling LLM for scoring", { repo: evidence.candidate.fullName, model: LLM_MODEL });
  const analysis = await scoreRepo(intent, evidence);

  if (analysis.source === "ai") {
    try {
      await prisma.modelAnalysis.create({
        data: {
          repoId,
          searchQueryId,
          modelName: LLM_MODEL,
          inputHash,
          outputJson: asJson(analysis),
        },
      });
      log.debug("Analysis cached", { repo: evidence.candidate.fullName });
    } catch (err) {
      log.warn("Failed to cache analysis (non-fatal)", err);
    }
  }
  return analysis;
}

/**
 * The full search pipeline. Runs in the background after POST /api/search.
 * Updates the SearchJob as it progresses; writes SearchResult rows at the end.
 */
export async function runSearch(
  searchQueryId: string,
  prompt: string,
  filters?: SearchFilters,
): Promise<void> {
  const searchLog = createLogger(`pipeline:${searchQueryId.slice(0, 8)}`);
  searchLog.info("Search started", {
    prompt,
    filters,
    llmEnabled: isLlmEnabled(),
    model: isLlmEnabled() ? LLM_MODEL : "deterministic",
  });

  try {
    // ── Stages 1 + 2: Intent extraction and candidate search — PARALLEL ───────
    // Build a heuristic intent instantly (no LLM) and launch GitHub search with
    // it immediately. The LLM intent extraction runs concurrently; when it lands
    // we use the better queries/constraints for the funnel, and check the cache
    // to avoid a second GitHub round-trip if the LLM queries were already seen.
    await setJob(searchQueryId, { status: "running", stage: "intent", progress: 5 });

    const heuristic = heuristicIntent(prompt, filters);
    const doneIntent = searchLog.time("intent extraction");

    // Fire LLM intent and heuristic-based search simultaneously.
    const searchTtlMs = (Number(process.env.SEARCH_CACHE_TTL_HOURS) || 2) * 3_600_000;

    const [intentResult, heuristicCandidates] = await Promise.all([
      extractIntent(prompt, filters).catch((err) => {
        searchLog.warn("LLM intent failed, using heuristic", err);
        return heuristic;
      }),
      (async () => {
        const h = hashJson({ q: [...heuristic.queries].sort(), max: env.MAX_CANDIDATES });
        const cached = await loadCandidateCache(h, searchTtlMs).catch(() => null);
        if (cached && cached.length > 0) return { candidates: cached, fromCache: true };
        const results = await searchCandidates(heuristic.queries, heuristic.constraints, {
          maxPool: env.MAX_CANDIDATES,
        });
        saveCandidateCache(h, results).catch(() => {});
        return { candidates: results, fromCache: false };
      })(),
    ]);

    const intent: Intent = intentResult;
    doneIntent();
    searchLog.info("Intent extracted", {
      normalizedPrompt: intent.normalizedPrompt,
      queries: intent.queries,
    });

    const intentHash = hashJson({ p: intent.normalizedPrompt, c: intent.constraints });
    await prisma.searchQuery.update({
      where: { id: searchQueryId },
      data: {
        normalizedPrompt: intent.normalizedPrompt,
        extractedConstraints: asJson(intent.constraints),
        intentHash,
      },
    });

    await setJob(searchQueryId, { stage: "search", progress: 20 });
    const doneSearch = searchLog.time("GitHub candidate search");

    // LLM-first strategy: the LLM intent always wins when it differs from the
    // heuristic. The heuristic search that ran in parallel is kept as a fallback
    // (zero-cost since it already ran) but we prefer the LLM's richer queries.
    let candidates: Awaited<ReturnType<typeof searchCandidates>>;
    const llmHash = hashJson({ q: [...intent.queries].sort(), max: env.MAX_CANDIDATES });
    const llmQueriesDiffer = llmHash !== hashJson({ q: [...heuristic.queries].sort(), max: env.MAX_CANDIDATES });

    if (llmQueriesDiffer) {
      // Check if we already have cached results for the LLM queries.
      const llmCached = await loadCandidateCache(llmHash, searchTtlMs).catch(() => null);
      if (llmCached && llmCached.length > 0) {
        candidates = llmCached;
        searchLog.info("Candidates found (LLM cache hit)", { count: candidates.length });
      } else {
        // Run the LLM queries — they're richer, topic-aware, and expanded.
        // Do NOT prefer the heuristic results: we want what the LLM asked for.
        candidates = await searchCandidates(intent.queries, intent.constraints, {
          maxPool: env.MAX_CANDIDATES,
        });
        saveCandidateCache(llmHash, candidates).catch(() => {});
        searchLog.info("Candidates found (LLM fresh search)", { count: candidates.length });

        // Only fall back to the parallel heuristic results if LLM search failed.
        if (candidates.length === 0 && heuristicCandidates.candidates.length > 0) {
          candidates = heuristicCandidates.candidates;
          searchLog.info("Fallback to heuristic candidates (LLM search empty)", {
            count: candidates.length,
          });
        }
      }
    } else {
      // LLM produced the same queries as heuristic (or LLM was disabled/failed).
      // Use the already-available heuristic results — no extra round-trip needed.
      candidates = heuristicCandidates.candidates;
      searchLog.info("Candidates found (heuristic / same queries)", {
        count: candidates.length,
        fromCache: heuristicCandidates.fromCache,
      });
    }
    doneSearch();

    if (candidates.length === 0) {
      searchLog.warn("No candidates found — completing with empty results");
      await setJob(searchQueryId, { status: "completed", stage: "done", progress: 100 });
      return;
    }

    // ── Stage 3: Funnel / narrowing ───────────────────────────────────────────
    await setJob(searchQueryId, { stage: "funnel", progress: 35 });
    const doneFunnel = searchLog.time("funnel narrowing", {
      candidates: candidates.length,
      topN: env.FUNNEL_TOP_N,
    });
    let funnelResult: Awaited<ReturnType<typeof narrowCandidates>>;
    try {
      funnelResult = await narrowCandidates(candidates, intent, env.FUNNEL_TOP_N);
      doneFunnel();
      searchLog.info("Funnel complete", { survivors: funnelResult.entries.length });
    } catch (err) {
      searchLog.error("Funnel narrowing failed", err);
      throw new Error(`Funnel failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { intentEmbedding, entries } = funnelResult;
    try {
      await setIntentEmbedding(searchQueryId, intentEmbedding);
    } catch (err) {
      searchLog.warn("Failed to store intent embedding (non-fatal)", err);
    }

    // ── Stage 4: Enrich survivors (cache-first, then one batched query) ──────
    // Upsert repos first so we can key the enrichment cache by repo UUID. Cached
    // evidence (fresh within TTL) skips GitHub entirely; only misses hit the
    // single batched GraphQL query. Live volatile data (stars, similarity, open
    // issues) is merged back in from the current candidate.
    await setJob(searchQueryId, { stage: "enrich", progress: 45 });
    const doneEnrich = searchLog.time("enrichment", { repos: entries.length });

    const repoIds = await Promise.all(entries.map((e) => upsertRepo(e.candidate)));

    const ttlMs = (Number(process.env.ENRICH_CACHE_TTL_HOURS) || 12) * 3_600_000;
    const cache = await loadEnrichmentCache(repoIds, ttlMs);

    const missIdx = entries
      .map((_, i) => i)
      .filter((i) => !cache.has(repoIds[i]));

    const freshList = await enrichReposBatch(
      missIdx.map((i) => ({ candidate: entries[i].candidate, similarity: entries[i].similarity })),
    );
    const freshByIdx = new Map<number, RepoEvidence>();
    missIdx.forEach((i, k) => freshByIdx.set(i, freshList[k]));

    // Persist fresh evidence to the cache (best-effort, parallel).
    await Promise.all(
      missIdx.map((i) =>
        saveEnrichmentCache(repoIds[i], freshByIdx.get(i)!).catch((err) =>
          searchLog.warn("Failed to cache enrichment (non-fatal)", err),
        ),
      ),
    );

    // Assemble the full evidence list (cache hits merged with the live candidate).
    const evidences: RepoEvidence[] = entries.map((entry, i) => {
      const cached = cache.get(repoIds[i]);
      if (cached) {
        return {
          ...cached,
          candidate: entry.candidate,
          similarity: entry.similarity,
          openIssues: entry.candidate.openIssues,
        };
      }
      return freshByIdx.get(i)!;
    });
    doneEnrich();
    searchLog.info("Enrichment done", {
      repos: entries.length,
      cacheHits: entries.length - missIdx.length,
      fetched: missIdx.length,
    });

    // Evidence embeddings (best-effort, off the critical path): one batched ONNX
    // call that runs concurrently with scoring instead of serially per repo.
    const evTexts = entries.map((entry, i) =>
      [
        entry.candidate.description ?? "",
        entry.candidate.topics.join(" "),
        (evidences[i].readme ?? "").slice(0, 1500),
      ].join(". "),
    );
    void embedBatch(evTexts)
      .then((vecs) =>
        Promise.all(
          repoIds.map((repoId, i) =>
            upsertRepoEmbedding(repoId, "evidence", sha256(evTexts[i]), vecs[i]).catch(() => {}),
          ),
        ),
      )
      .catch((err) => searchLog.warn("Evidence embedding batch failed (non-fatal)", err));

    // ── Stage 5: Score (concurrent pool) ─────────────────────────────────────
    // Evidence is ready for everyone; now run scoring concurrently. `entries` is
    // funnel-ranked, so the first LLM_SCORE_TOP_N get the LLM and the tail keeps
    // its instant deterministic score. Default LLM_SCORE_TOP_N=20 ⇒ all scored.
    await setJob(searchQueryId, { stage: "score", progress: 65 });
    const llmTopN = isLlmEnabled() ? Math.min(env.LLM_SCORE_TOP_N, entries.length) : 0;
    searchLog.info("Score plan", {
      survivors: entries.length,
      llmScored: llmTopN,
      deterministicOnly: entries.length - llmTopN,
      concurrency: env.ANALYZE_CONCURRENCY,
      model: isLlmEnabled() ? LLM_MODEL : "deterministic",
    });

    const scored: { analysis: Analysis; evidence: RepoEvidence; repoId: string }[] = [];
    let completedCount = 0;

    await runPool(
      entries.map((entry, index) => ({ entry, evidence: evidences[index], repoId: repoIds[index], index })),
      env.ANALYZE_CONCURRENCY,
      async ({ entry, evidence, repoId, index }) => {
        const repoLog = createLogger(`pipeline:${entry.candidate.fullName}`);
        try {
          await saveSnapshot(repoId, entry.candidate);
          await saveReadme(repoId, evidence);

          // Deterministic baseline — instant, and the fallback if the LLM call is
          // skipped (tail) or throws.
          let analysis = deterministicScore(intent, evidence);
          if (index < llmTopN) {
            const doneScore = repoLog.time("scoring");
            try {
              analysis = await scoreWithCache(intent, evidence, repoId, searchQueryId, intentHash);
            } catch (err) {
              repoLog.error(`LLM scoring failed for ${entry.candidate.fullName} (keeping deterministic)`, err);
            }
            doneScore();
          }

          repoLog.info("Scored", {
            fit: analysis.fit.toFixed(2),
            future: analysis.future.toFixed(2),
            underrated: analysis.underrated.toFixed(2),
            total: analysis.total.toFixed(2),
            source: analysis.source,
          });
          scored.push({ analysis, evidence, repoId });
        } catch (err) {
          repoLog.error(`Failed to score ${entry.candidate.fullName} (skipping)`, err);
        }
        completedCount++;
        await setJob(searchQueryId, {
          stage: `score ${completedCount}/${entries.length}`,
          progress: 65 + Math.round((30 * completedCount) / entries.length),
        });
      },
    );

    searchLog.info("Analysis complete", { scoredCount: scored.length });

    // ── Stage 5: Persist ranked results ──────────────────────────────────────
    // Rank by RELEVANCE (fit + similarity), not quality (total).
    //
    // `total` is shown to users as a quality indicator but must not drive rank:
    // a wildly popular repo with a high health/future score can have total=0.77
    // while a perfectly on-point small new repo has total=0.53. That would bury
    // the best result. Health is a displayed signal, not a ranking signal.
    //
    //   - AI-scored: LLM fit is semantically precise → weight it heavily.
    //   - Deterministic: ONNX similarity is the best raw relevance signal →
    //     blend it equally with the noisier keyword-based fit score.
    // Establishment prior. MiniLM cosine similarities are compressed into a
    // narrow band (≈0.6–0.8), so relevance alone can't separate the canonical
    // library from an obscure exact-keyword match — a 500-star dead repo and a
    // 60k-star standard score nearly the same. A log-scaled popularity term
    // breaks that tie toward the proven project. It is GATED by relevance
    // (multiplied in, not added) so a popular-but-irrelevant repo gets no lift,
    // and CAPPED low so a genuinely strong small repo still surfaces — the
    // "hidden gems" promise stays intact.
    const POP_WEIGHT = Number(process.env.POPULARITY_WEIGHT) || 0.25;
    const popularityPrior = (stars: number): number =>
      Math.min(1, Math.log10(Math.max(stars, 0) + 1) / 6); // ~0.5@1k, 0.8@60k, 1@1M

    const rankScore = (s: (typeof scored)[0]): number => {
      const sim = s.evidence.similarity;
      const relevance =
        s.analysis.source === "ai"
          ? // Trust the LLM's fit judgement; similarity is a minor tiebreaker.
            s.analysis.fit * 0.85 + sim * 0.15
          : // Deterministic: fit and similarity are complementary relevance
            // signals — blend them equally.
            s.analysis.fit * 0.6 + sim * 0.4;
      const pop = popularityPrior(s.evidence.candidate.stars);
      return relevance * (1 + POP_WEIGHT * pop);
    };
    scored.sort((a, b) => rankScore(b) - rankScore(a));

    const minFuture = filters?.minFutureScore ?? null;
    let rank = 1;
    for (const r of scored) {
      if (minFuture != null && r.analysis.future < minFuture) continue;
      await saveResult({
        searchQueryId,
        repoId: r.repoId,
        rank,
        analysis: r.analysis,
        evidence: r.evidence,
      });
      rank++;
    }

    searchLog.info("Search complete", { resultsStored: rank - 1 });
    await setJob(searchQueryId, { status: "completed", stage: "done", progress: 100 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    searchLog.error("runSearch pipeline failed", error, { searchQueryId, prompt });
    console.error("[pipeline] runSearch failed:", error);
    await setJob(searchQueryId, {
      status: "failed",
      error: stack ? `${msg}\n\n${stack}` : msg,
      progress: 100,
    });
  }
}
