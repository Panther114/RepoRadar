import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env, isLlmEnabled } from "@/lib/env";
import { LLM_MODEL } from "@/lib/llm/client";
import { extractIntent, heuristicIntent } from "@/lib/llm/intent";
import { searchCandidatesDetailed } from "@/lib/github/search";
import { narrowCandidates } from "@/lib/funnel/narrow";
import { enrichReposBatch } from "@/lib/github/enrich";
import { fetchLightRepoEvidenceBatch } from "@/lib/github/lightEnrich";
import { scoreRepo } from "@/lib/llm/score";
import { applyListwiseRanking, rankReposListwise } from "@/lib/llm/listwise";
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
import { findGuidanceHints } from "@/lib/search/guidance";
import { generateHydeDoc } from "@/lib/search/hyde";
import { expandByTopics } from "@/lib/search/graphExpand";
import { buildReferenceContext } from "@/lib/search/referenceResolver";
import { mineAwesomeLists } from "@/lib/search/awesome";
import { searchRegistries } from "@/lib/search/registries";
import { normalizeCanonicalNames } from "@/lib/search/canonical";
import { fetchCandidatesByName } from "@/lib/github/fetchRepos";
import { passesInjectionGate } from "@/lib/search/sourceGate";
import { writeSearchDiagnostics } from "@/lib/pipeline/diagnostics";
import { debugTrace, searchDebugEnabled } from "@/lib/pipeline/debugTrace";
import type { Analysis, Candidate, Intent, RepoEvidence, SearchDiagnostics, SearchFilters } from "@/lib/types";

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

function adaptiveMaxQueries(prompt: string, candidatesKnownLow = false): number {
  const configured = Number(process.env.MAX_SEARCH_QUERIES) || 6;
  const shortPrompt = prompt.trim().split(/\s+/).filter(Boolean).length <= 4;
  return Math.min(8, Math.max(configured, shortPrompt || candidatesKnownLow ? 6 : 4));
}

function makeDiagnostics(args: {
  searchQueryId: string;
  prompt: string;
  intent: Intent;
  resolvedCanonicalNames: string[];
  heuristic: Intent;
  activeQueries: string[];
  perQueryResults: { query: string; total: number; repos: string[] }[];
  dedupeCount: number;
  candidates: Candidate[];
  survivors?: string[];
}): SearchDiagnostics {
  const canonicalNames = args.resolvedCanonicalNames;
  const candidateNames = new Set(args.candidates.map((c) => c.fullName.toLowerCase()));
  const survivorNames = new Set((args.survivors ?? []).map((name) => name.toLowerCase()));
  const droppedKnownCandidates = canonicalNames.filter((name) => {
    const n = name.toLowerCase();
    return candidateNames.has(n) && !survivorNames.has(n);
  });
  const now = new Date().toISOString();
  return {
    searchQueryId: args.searchQueryId,
    prompt: args.prompt,
    llmQueries: args.intent.queries,
    heuristicQueries: args.heuristic.queries,
    guidanceHints: findGuidanceHints(args.prompt),
    canonicalNames,
    resolvedCanonicalNames: canonicalNames,
    activeQueries: args.activeQueries,
    perQueryResults: args.perQueryResults,
    dedupeCount: args.dedupeCount,
    candidatePoolCount: args.candidates.length,
    candidatePool: args.candidates.map((c) => c.fullName),
    funnelSurvivors: args.survivors ?? [],
    droppedKnownCandidates,
    startedAt: now,
    updatedAt: now,
  };
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

    const [intentResult, heuristicCandidates, refContextEarly] = await Promise.all([
      extractIntent(prompt, filters).catch((err) => {
        searchLog.warn("LLM intent failed, using heuristic", err);
        return heuristic;
      }),
      (async () => {
        const h = hashJson({
          q: [...heuristic.queries].sort(),
          canonical: [...(heuristic.canonicalNames ?? [])].sort(),
          max: env.MAX_CANDIDATES,
        });
        const cached = await loadCandidateCache(h, searchTtlMs).catch(() => null);
        if (cached && cached.length > 0) return { candidates: cached, fromCache: true };
        const results = await searchCandidatesDetailed(heuristic.queries, heuristic.constraints, {
          maxPool: env.MAX_CANDIDATES,
          maxQueries: adaptiveMaxQueries(prompt),
          canonicalNames: heuristic.canonicalNames ?? [],
        });
        saveCandidateCache(h, results.candidates).catch(() => {});
        return { candidates: results.candidates, fromCache: false };
      })(),
      // Reference resolution (v1.1.4): regex-detected "alternative to X" /
      // "like X" references resolve concurrently with intent extraction.
      buildReferenceContext(prompt).catch((err) => {
        searchLog.warn("Reference resolution failed (non-fatal)", err);
        return null;
      }),
    ]);

    const intent: Intent = intentResult;
    doneIntent();

    // If the regexes found nothing but the LLM intent did flag a referenced
    // project, resolve it now (rare; costs one extra GitHub call).
    let refContext = refContextEarly;
    if (!refContext && intent.referencedProjects?.length) {
      refContext = await buildReferenceContext(prompt, intent.referencedProjects).catch(() => null);
    }
    if (refContext) {
      // High-precision reference queries slot in at position 1 — early enough
      // to survive the active-query cap, but leaving the LLM's strongest query
      // at position 0 so sort-variant re-issues (which seed from the top 2)
      // cover one LLM query AND one reference query instead of only references.
      // Anchor text feeds the funnel's intent embedding.
      intent.queries = Array.from(
        new Set([...intent.queries.slice(0, 1), ...refContext.refQueries, ...intent.queries.slice(1)]),
      );
      intent.anchorText = refContext.anchorText;
      searchLog.info("Reference resolved", {
        referenced: refContext.referenced.map((r) => r.fullName),
        refQueries: refContext.refQueries,
      });
    }
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
    let candidates: Candidate[];
    let activeQueries: string[] = [];
    let perQueryResults: { query: string; total: number; repos: string[] }[] = [];
    let dedupeCount = 0;
    let resolvedCanonicalNames: string[] = [];
    const llmHash = hashJson({
      q: [...intent.queries].sort(),
      canonical: [...(intent.canonicalNames ?? [])].sort(),
      max: env.MAX_CANDIDATES,
    });
    const llmQueriesDiffer = llmHash !== hashJson({
      q: [...heuristic.queries].sort(),
      canonical: [...(heuristic.canonicalNames ?? [])].sort(),
      max: env.MAX_CANDIDATES,
    });

    if (llmQueriesDiffer) {
      // Check if we already have cached results for the LLM queries.
      const llmCached = await loadCandidateCache(llmHash, searchTtlMs).catch(() => null);
      if (llmCached && llmCached.length > 0) {
        candidates = llmCached;
        searchLog.info("Candidates found (LLM cache hit)", { count: candidates.length });
      } else {
        // Run the LLM queries — they're richer, topic-aware, and expanded.
        // Do NOT prefer the heuristic results: we want what the LLM asked for.
        const details = await searchCandidatesDetailed(intent.queries, intent.constraints, {
          maxPool: env.MAX_CANDIDATES,
          maxQueries: adaptiveMaxQueries(prompt),
          canonicalNames: intent.canonicalNames ?? [],
        });
        candidates = details.candidates;
        activeQueries = details.activeQueries;
        perQueryResults = details.perQueryResults;
        dedupeCount = details.dedupeCount;
        resolvedCanonicalNames = details.resolvedCanonicalNames;
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
      activeQueries = heuristic.queries.slice(0, adaptiveMaxQueries(prompt));
      searchLog.info("Candidates found (heuristic / same queries)", {
        count: candidates.length,
        fromCache: heuristicCandidates.fromCache,
      });
    }
    intent.canonicalNames = normalizeCanonicalNames(intent.canonicalNames ?? [], candidates, resolvedCanonicalNames);
    doneSearch();

    writeSearchDiagnostics(makeDiagnostics({
      searchQueryId,
      prompt,
      intent,
      resolvedCanonicalNames: intent.canonicalNames ?? [],
      heuristic,
      activeQueries,
      perQueryResults,
      dedupeCount,
      candidates,
    }));

    if (candidates.length === 0) {
      searchLog.warn("No candidates found — completing with empty results");
      await setJob(searchQueryId, { status: "completed", stage: "done", progress: 100 });
      return;
    }

    // HyDE (B4): start the hypothetical-doc generation now so it overlaps with
    // light enrichment below; resolved just before the funnel. No-op unless
    // HYDE=true and the LLM is enabled.
    const hydePromise = generateHydeDoc(prompt).catch(() => null);

    // Graph expansion via topics (B3a): broaden the pool with topic-neighbours of
    // the strongest candidates before the funnel narrows. No-op unless GRAPH_TOPICS=true.
    try {
      const expansion = await expandByTopics(candidates);
      if (expansion.candidates.length) {
        const seen = new Set(candidates.map((cand) => cand.githubId));
        let added = 0;
        for (const cand of expansion.candidates) {
          if (seen.has(cand.githubId)) continue;
          if (candidates.length >= env.MAX_CANDIDATES) break;
          candidates.push(cand);
          seen.add(cand.githubId);
          added++;
        }
        if (added) searchLog.info("Topic graph expansion added candidates", { added, topicQueries: expansion.topicQueries });
      }
    } catch (err) {
      searchLog.warn("Topic graph expansion failed (non-fatal)", err);
    }

    // Diverse sources (v1.1.4): awesome-list mining + package registries feed
    // two things — extra candidates the GitHub keyword search missed, and a
    // curated-membership set the funnel uses as a quality boost. Registries
    // only fire for explicitly library-shaped queries (npm hits for an infra
    // query like "kubernetes monitoring" are wrappers, not answers). The fetch
    // overlaps the GitHub-pool/graph work above and has a hard 10s budget — a
    // slow registry can never stall the pipeline. Dedupe happens at merge.
    const REGISTRY_TYPES = new Set(["library", "framework", "cli", "plugin", "extension", "template"]);
    const curatedSet = new Set<string>();
    const sourcesPromise = Promise.race([
      Promise.all([
        mineAwesomeLists(intent.constraints.keywords).catch(() => ({ curatedNames: [], lists: [] })),
        REGISTRY_TYPES.has(intent.constraints.projectType)
          ? searchRegistries(intent.constraints.keywords, intent.constraints.language).catch(() => [])
          : Promise.resolve([]),
      ]).then(async ([awesome, registryNames]) => {
        const newNames = [...awesome.curatedNames.slice(0, 40), ...registryNames];
        const fetched = newNames.length ? await fetchCandidatesByName(newNames.slice(0, 25)) : [];
        return { awesome, registryNames, fetched };
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]).catch(() => null);

    // An "alternative to X" search must never return X itself.
    if (refContext?.excludeFullNames.length) {
      const excluded = new Set(refContext.excludeFullNames);
      const before = candidates.length;
      candidates = candidates.filter((cand) => !excluded.has(cand.fullName.toLowerCase()));
      if (candidates.length < before) {
        searchLog.info("Excluded referenced repo(s) from pool", {
          excluded: refContext.excludeFullNames,
        });
      }
    }

    // Merge the gated source candidates BEFORE light enrichment so injected
    // repos get README-head evidence too — without it their thin text loses
    // the cross-encoder shortlist to keyword-stuffed organic candidates even
    // when they are the better answer (react-data-table pool recall hit 1.00
    // but nDCG fell in the first cut for exactly this reason). Every injected
    // repo must pass the topicality/traction/liveness gate, and displacement
    // of the organic pool tail is capped at 10% so out-of-band sources can
    // never crowd out organically-retrieved candidates.
    const lightEnrichTopN = Number(process.env.LIGHT_ENRICH_TOP_N) || 20;
    let sourceAdded = 0;
    const sources = await sourcesPromise;
    if (sources) {
      for (const name of sources.awesome.curatedNames) curatedSet.add(name.toLowerCase());
      const inPool = new Set(candidates.map((cand) => cand.fullName.toLowerCase()));
      const excluded = new Set(refContext?.excludeFullNames ?? []);
      const gated = sources.fetched.filter(
        (cand) =>
          !inPool.has(cand.fullName.toLowerCase()) &&
          !excluded.has(cand.fullName.toLowerCase()) &&
          passesInjectionGate(cand, intent.constraints.keywords, intent.constraints.includeSmallProjects),
      );
      const maxNew = Math.min(gated.length, 12);
      const maxEvict = Math.floor(env.MAX_CANDIDATES * 0.1);
      const spare = Math.max(0, env.MAX_CANDIDATES - candidates.length);
      const budget = Math.min(maxNew, spare + maxEvict);
      const overflow = Math.max(0, candidates.length + budget - env.MAX_CANDIDATES);
      if (overflow > 0) {
        const protectedNames = new Set(
          (intent.canonicalNames ?? [])
            .map((name) => name.trim().replace(/^https:\/\/github\.com\//i, "").toLowerCase())
            .filter((name) => name.includes("/")),
        );
        let remaining = overflow;
        for (let i = candidates.length - 1; i >= 0 && remaining > 0; i--) {
          if (protectedNames.has(candidates[i].fullName.toLowerCase())) continue;
          candidates.splice(i, 1);
          remaining--;
        }
        if (remaining > 0) candidates.splice(Math.max(0, candidates.length - remaining), remaining);
      }
      // Insert at the light-enrichment boundary: inside the enrichment window,
      // without demoting the organic head out of it.
      const insertAt = Math.min(lightEnrichTopN, candidates.length);
      const toInsert = gated.slice(0, budget);
      candidates.splice(insertAt, 0, ...toInsert);
      sourceAdded = toInsert.length;
      searchLog.info("Diverse sources merged", {
        awesomeLists: sources.awesome.lists,
        curatedTotal: sources.awesome.curatedNames.length,
        registryHits: sources.registryNames.length,
        fetched: sources.fetched.length,
        passedGate: gated.length,
        candidatesAdded: sourceAdded,
      });
    } else {
      searchLog.warn("Diverse sources unavailable (timeout/failure) — continuing without them");
    }

    // ── Stage 3: Funnel / narrowing ───────────────────────────────────────────
    await setJob(searchQueryId, { stage: "funnel", progress: 35 });
    const lightEvidence = await fetchLightRepoEvidenceBatch(
      candidates,
      lightEnrichTopN + sourceAdded,
    ).catch((err) => {
      searchLog.warn("Light enrichment failed; funnel will use metadata only", err);
      return undefined;
    });
    const doneFunnel = searchLog.time("funnel narrowing", {
      candidates: candidates.length,
      topN: env.FUNNEL_TOP_N,
    });
    const hydeDoc = await hydePromise;
    if (hydeDoc) searchLog.info("HyDE doc generated", { preview: hydeDoc.slice(0, 80) });
    let funnelResult: Awaited<ReturnType<typeof narrowCandidates>>;
    try {
      funnelResult = await narrowCandidates(
        candidates,
        intent,
        env.FUNNEL_TOP_N,
        lightEvidence,
        intent.canonicalNames ?? [],
        { searchQueryId },
        hydeDoc,
        curatedSet.size ? curatedSet : undefined,
      );
      doneFunnel();
      searchLog.info("Funnel complete", { survivors: funnelResult.entries.length });
    } catch (err) {
      searchLog.error("Funnel narrowing failed", err);
      throw new Error(`Funnel failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { intentEmbedding, entries } = funnelResult;
    writeSearchDiagnostics(makeDiagnostics({
      searchQueryId,
      prompt,
      intent,
      resolvedCanonicalNames: intent.canonicalNames ?? [],
      heuristic,
      activeQueries,
      perQueryResults,
      dedupeCount,
      candidates,
      survivors: entries.map((entry) => entry.candidate.fullName),
    }));
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

    // ── Stage 5: Score / listwise rank ───────────────────────────────────────
    // Evidence is ready for everyone. Compute deterministic baselines for health
    // and fallback, then prefer one cheap listwise model call for relative fit.
    await setJob(searchQueryId, { stage: "score", progress: 65 });
    searchLog.info("Score plan", {
      survivors: entries.length,
      listwise: isLlmEnabled(),
      model: isLlmEnabled() ? LLM_MODEL : "deterministic",
    });

    const scored: { analysis: Analysis; evidence: RepoEvidence; repoId: string }[] = [];
    const baselines: Analysis[] = [];

    await runPool(
      entries.map((entry, index) => ({ entry, evidence: evidences[index], repoId: repoIds[index], index })),
      env.ANALYZE_CONCURRENCY,
      async ({ entry, evidence, repoId, index }) => {
        const repoLog = createLogger(`pipeline:${entry.candidate.fullName}`);
        try {
          await saveSnapshot(repoId, entry.candidate);
          await saveReadme(repoId, evidence);
          baselines[index] = deterministicScore(intent, evidence);
        } catch (err) {
          repoLog.error(`Failed to save baseline evidence for ${entry.candidate.fullName} (skipping)`, err);
        }
      },
    );

    let listwiseApplied = false;
    if (isLlmEnabled() && baselines.length === evidences.length) {
      const doneListwise = searchLog.time("listwise rerank", { repos: evidences.length });
      try {
        const listwise = await rankReposListwise(intent, evidences, baselines);
        doneListwise();
        if (listwise) {
          const repoIdByName = new Map(evidences.map((e, i) => [e.candidate.fullName.toLowerCase(), repoIds[i]]));
          for (const ranked of applyListwiseRanking({ evidences, baselines, listwise })) {
            scored.push({
              analysis: ranked.analysis,
              evidence: ranked.evidence,
              repoId: repoIdByName.get(ranked.evidence.candidate.fullName.toLowerCase())!,
            });
          }
          listwiseApplied = true;
          searchLog.info("Listwise rerank applied", { scoredCount: scored.length });
        }
      } catch (err) {
        doneListwise();
        searchLog.warn("Listwise rerank failed; falling back to pointwise scoring", err);
      }
    }

    if (!listwiseApplied) {
      let completedCount = 0;
      const llmTopN = isLlmEnabled() ? Math.min(env.LLM_SCORE_TOP_N, entries.length) : 0;
      await runPool(
        entries.map((entry, index) => ({ entry, evidence: evidences[index], repoId: repoIds[index], index })),
        env.ANALYZE_CONCURRENCY,
        async ({ entry, evidence, repoId, index }) => {
          const repoLog = createLogger(`pipeline:${entry.candidate.fullName}`);
          try {
            let analysis = baselines[index] ?? deterministicScore(intent, evidence);
            if (index < llmTopN) {
              const doneScore = repoLog.time("pointwise scoring fallback");
              try {
                analysis = await scoreWithCache(intent, evidence, repoId, searchQueryId, intentHash);
              } catch (err) {
                repoLog.error(`LLM scoring failed for ${entry.candidate.fullName} (keeping deterministic)`, err);
              }
              doneScore();
            }
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
    }

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
    if (!listwiseApplied) scored.sort((a, b) => rankScore(b) - rankScore(a));

    if (searchDebugEnabled()) {
      debugTrace("final-rank", searchQueryId, {
        listwiseApplied,
        results: scored.map((s, i) => ({
          finalRank: i + 1,
          repo: s.evidence.candidate.fullName,
          stars: s.evidence.candidate.stars,
          source: s.analysis.source,
          fit: Number(s.analysis.fit.toFixed(4)),
          future: Number(s.analysis.future.toFixed(4)),
          similarity: Number(s.evidence.similarity.toFixed(4)),
          rankScore: Number(rankScore(s).toFixed(4)),
        })),
      });
    }

    const minFuture = filters?.minFutureScore ?? null;
    const dropIrrelevantResults = String(process.env.RESULT_RELEVANCE_FLOOR ?? "true").toLowerCase() !== "false";
    const explicitlyAskedForSmall =
      filters?.includeSmallProjects === true ||
      /\b(small|underrated|hidden|niche|lesser|promising|new)\b/i.test(prompt);
    const explicitlyAskedForMeta =
      /\b(awesome|list|comparison|compare|benchmark|benchmarks|survey)\b/i.test(prompt);
    const shouldDropLowSignal = (r: (typeof scored)[0]): boolean =>
      !explicitlyAskedForSmall &&
      r.evidence.candidate.stars < 50 &&
      (r.analysis.future < 0.25 || r.analysis.fit < 0.5);
    const shouldDropMetaRepo = (r: (typeof scored)[0]): boolean => {
      if (explicitlyAskedForMeta) return false;
      const text = [
        r.evidence.candidate.fullName,
        r.evidence.candidate.name,
        r.evidence.candidate.description ?? "",
        r.analysis.repoType,
      ].join(" ").toLowerCase();
      return /\b(awesome|comparison|benchmark|benchmarks|survey)\b/.test(text);
    };
    let rank = 1;
    let relevanceDropped = 0;
    let lowSignalDropped = 0;
    let metaDropped = 0;
    for (const r of scored) {
      if (dropIrrelevantResults && r.analysis.relevant === false) {
        relevanceDropped++;
        continue;
      }
      if (dropIrrelevantResults && shouldDropMetaRepo(r)) {
        metaDropped++;
        continue;
      }
      if (dropIrrelevantResults && shouldDropLowSignal(r)) {
        lowSignalDropped++;
        continue;
      }
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

    searchLog.info("Search complete", {
      resultsStored: rank - 1,
      relevanceDropped,
      lowSignalDropped,
      metaDropped,
      dropIrrelevantResults,
    });
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
