import { octokit } from "@/lib/github/client";
import type { Candidate, Constraints } from "@/lib/types";

interface SearchOptions {
  perQuery?: number;
  maxPool?: number;
  maxQueries?: number;
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
  // 20 results per query keeps the ONNX embedding batch at a safe size.
  // Breadth comes from 6 DIVERSE query strategies (topic:, OR, in:readme, etc.)
  // not from more results per query. 6×20 = up to 120 raw, ~60-80 after dedup.
  const perQuery = options.perQuery ?? 20;
  const maxPool = options.maxPool ?? 80;
  const maxQueries = options.maxQueries ?? (Number(process.env.MAX_SEARCH_QUERIES) || 6);

  const byId = new Map<number, Candidate>();

  // Cap the number of variants we actually execute. The LLM can emit 6+ largely
  // overlapping queries; each adds a (slow) GitHub Search round-trip and the
  // octokit throttle plugin can serialise them. The first few variants are the
  // highest-signal (keyword+lang, recency, topic), so 4 keeps recall while
  // cutting search latency.
  const activeQueries = queries.slice(0, maxQueries);

  // Fire the variants concurrently — each is an independent search.
  const results = await Promise.allSettled(
    activeQueries.map((q) => octokit.rest.search.repos({ q, per_page: perQuery })),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[github] search query failed:", result.reason);
      continue;
    }
    for (const item of result.value.data.items as unknown as RepoSearchItem[]) {
      if (item.archived || item.fork) continue;
      if (!byId.has(item.id)) byId.set(item.id, toCandidate(item));
    }
    if (byId.size >= maxPool) break;
  }

  // Zero-result fallback: strip language/recency/stars filters from the first
  // query and retry with the core terms only. This catches cases where the LLM
  // or heuristic produces a query that's too specific for GitHub's index.
  if (byId.size === 0 && activeQueries.length > 0) {
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
        for (const item of fb.data.items as unknown as RepoSearchItem[]) {
          if (item.archived || item.fork) continue;
          if (!byId.has(item.id)) byId.set(item.id, toCandidate(item));
        }
      } catch (err) {
        console.warn("[github] fallback search failed:", err);
      }
    }
  }

  return Array.from(byId.values()).slice(0, maxPool);
}
