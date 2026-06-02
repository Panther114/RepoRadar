import { octokit } from "@/lib/github/client";
import { fuseCandidateSources } from "@/lib/search/candidateFusion";
import type { Candidate, CandidateSource, Constraints } from "@/lib/types";

interface SearchOptions {
  perQuery?: number;
  maxPool?: number;
  maxQueries?: number;
  canonicalNames?: string[];
}

export interface SearchQueryDiagnostic {
  query: string;
  total: number;
  repos: string[];
}

export interface CandidateSearchResult {
  candidates: Candidate[];
  activeQueries: string[];
  perQueryResults: SearchQueryDiagnostic[];
  dedupeCount: number;
}

// Minimal shape of the fields we read from GitHub's search response items.
interface RepoSearchItem {
  id: number;
  full_name: string;
  owner: { login: string } | null;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  license: { spdx_id: string | null } | null;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  created_at: string | null;
  updated_at: string | null;
  pushed_at: string | null;
}

function toCandidate(item: RepoSearchItem): Candidate {
  return {
    githubId: item.id,
    fullName: item.full_name,
    owner: item.owner?.login ?? item.full_name.split("/")[0],
    name: item.name,
    htmlUrl: item.html_url,
    description: item.description,
    primaryLanguage: item.language,
    licenseSpdx: item.license?.spdx_id ?? null,
    topics: item.topics ?? [],
    isArchived: item.archived,
    isFork: item.fork,
    stars: item.stargazers_count,
    forks: item.forks_count,
    openIssues: item.open_issues_count,
    watchers: item.watchers_count,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    pushedAt: item.pushed_at,
  };
}

/**
 * Run every query variant against the GitHub Search API, merge + dedupe by id,
 * and drop archived/forked repos. Recency/license/star filtering is left to the
 * funnel so we keep a healthy pool. Errors on a single query are non-fatal.
 */
export async function searchCandidates(
  queries: string[],
  _constraints: Constraints,
  options: SearchOptions = {},
): Promise<Candidate[]> {
  return (await searchCandidatesDetailed(queries, _constraints, options)).candidates;
}

export async function searchCandidatesDetailed(
  queries: string[],
  _constraints: Constraints,
  options: SearchOptions = {},
): Promise<CandidateSearchResult> {
  // 20 results per query keeps the ONNX embedding batch at a safe size.
  // Breadth comes from 6 DIVERSE query strategies (topic:, OR, in:readme, etc.)
  // not from more results per query. 6×20 = up to 120 raw, ~60-80 after dedup.
  const perQuery = options.perQuery ?? 20;
  const maxPool = options.maxPool ?? 80;
  const maxQueries = options.maxQueries ?? Math.min(Math.max(Number(process.env.MAX_SEARCH_QUERIES) || 6, 4), 8);

  // Cap the number of variants we actually execute. The LLM can emit 6+ largely
  // overlapping queries; each adds a (slow) GitHub Search round-trip and the
  // octokit throttle plugin can serialise them. The first few variants are the
  // highest-signal (keyword+lang, recency, topic), so 4 keeps recall while
  // cutting search latency.
  const activeQueries = queries.slice(0, maxQueries);
  const sources: CandidateSource[] = [];
  const perQueryResults: SearchQueryDiagnostic[] = [];

  // Fire the variants concurrently — each is an independent search.
  const results = await Promise.allSettled(
    activeQueries.map((q) => octokit.rest.search.repos({ q, per_page: perQuery })),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const query = activeQueries[i];
    if (result.status === "rejected") {
      console.error("[github] search query failed:", result.reason);
      perQueryResults.push({ query, total: 0, repos: [] });
      continue;
    }
    const candidates: Candidate[] = [];
    for (const item of result.value.data.items as unknown as RepoSearchItem[]) {
      if (item.archived || item.fork) continue;
      candidates.push(toCandidate(item));
    }
    perQueryResults.push({
      query,
      total: result.value.data.total_count,
      repos: candidates.map((c) => c.fullName),
    });
    sources.push({ query, candidates });
  }

  let fused = fuseCandidateSources(sources, maxPool);
  const canonicalCandidates: Candidate[] = [];

  const canonicalFullNames = Array.from(
    new Set(
      (options.canonicalNames ?? [])
        .map((name) => name.trim().replace(/^https:\/\/github\.com\//i, ""))
        .filter((name) => /^[^/\s]+\/[^/\s]+$/.test(name)),
    ),
  ).slice(0, 8);

  if (canonicalFullNames.length) {
    const fetched = await Promise.allSettled(
      canonicalFullNames.map(async (fullName) => {
        const [owner, repo] = fullName.split("/");
        const result = await octokit.rest.repos.get({ owner, repo });
        const item = result.data as unknown as RepoSearchItem;
        if (item.archived || item.fork) return null;
        return toCandidate(item);
      }),
    );
    for (const result of fetched) {
      if (result.status === "fulfilled" && result.value) canonicalCandidates.push(result.value);
    }
    if (canonicalCandidates.length) {
      perQueryResults.push({
        query: "canonical-rescue",
        total: canonicalCandidates.length,
        repos: canonicalCandidates.map((candidate) => candidate.fullName),
      });
      const seen = new Set(fused.map((candidate) => candidate.githubId));
      const missing = canonicalCandidates.filter((candidate) => !seen.has(candidate.githubId));
      if (missing.length) {
        const missingIds = new Set(missing.map((candidate) => candidate.githubId));
        while (fused.length + missing.length > maxPool) {
          const replaceAt = [...fused].reverse().findIndex((candidate) => !missingIds.has(candidate.githubId));
          if (replaceAt < 0) break;
          fused.splice(fused.length - 1 - replaceAt, 1);
        }
      }
      for (const candidate of missing) {
        if (fused.length >= maxPool) break;
        fused.push(candidate);
        seen.add(candidate.githubId);
      }
    }
  }

  // Zero-result fallback: strip language/recency/stars filters from the first
  // query and retry with the core terms only. This catches cases where the LLM
  // or heuristic produces a query that's too specific for GitHub's index.
  if (fused.length === 0 && activeQueries.length > 0) {
    const stripped = activeQueries[0]
      .replace(/\s+language:\S+/gi, "")
      .replace(/\s+pushed:\S+/gi, "")
      .replace(/\s+stars:\S+/gi, "")
      .replace(/\s+in:\S+/gi, "")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(" ");

    if (stripped && stripped !== activeQueries[0]) {
      console.log(`[github] zero results — retrying with fallback: "${stripped}"`);
      try {
        const fb = await octokit.rest.search.repos({ q: stripped, per_page: perQuery });
        const candidates: Candidate[] = [];
        for (const item of fb.data.items as unknown as RepoSearchItem[]) {
          if (item.archived || item.fork) continue;
          candidates.push(toCandidate(item));
        }
        perQueryResults.push({ query: stripped, total: fb.data.total_count, repos: candidates.map((c) => c.fullName) });
        sources.push({ query: stripped, candidates });
        fused = fuseCandidateSources(sources, maxPool);
      } catch (err) {
        console.warn("[github] fallback search failed:", err);
      }
    }
  }

  return {
    candidates: fused,
    activeQueries,
    perQueryResults,
    dedupeCount: Math.max(
      0,
      sources.reduce((sum, source) => sum + source.candidates.length, 0) + canonicalCandidates.length - fused.length,
    ),
  };
}
