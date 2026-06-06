import { octokit } from "@/lib/github/client";
import type { Candidate } from "@/lib/types";

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
 * Graph expansion via GitHub topics (B3a). The best alternatives often share no
 * query keyword but DO share curator-applied topics (high-signal, human-tagged).
 * We take the most common topics among the strongest candidates already found
 * and fetch more repos under those topic combinations, sorted by stars. This
 * pulls in canonical neighbours pure keyword search missed — e.g. from a pool of
 * web frameworks, `topic:web-framework topic:rust` surfaces the ones the LLM's
 * keyword queries didn't name. Flag-gated (GRAPH_TOPICS); bounded fan-out.
 */
export async function expandByTopics(
  seeds: Candidate[],
  opts: { maxNewQueries?: number; perQuery?: number } = {},
): Promise<{ candidates: Candidate[]; topicQueries: string[] }> {
  if (String(process.env.GRAPH_TOPICS ?? "").toLowerCase() !== "true") {
    return { candidates: [], topicQueries: [] };
  }
  // Use only the strongest seeds (already pool-ordered) to avoid topic drift.
  const top = seeds.slice(0, 15);
  const freq = new Map<string, number>();
  for (const s of top) {
    for (const t of s.topics ?? []) {
      const topic = t.toLowerCase().trim();
      if (topic.length < 2) continue;
      freq.set(topic, (freq.get(topic) ?? 0) + 1);
    }
  }
  // Topics shared by ≥2 strong seeds are the discriminative ones.
  const ranked = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  if (ranked.length === 0) return { candidates: [], topicQueries: [] };

  const maxNewQueries = opts.maxNewQueries ?? 3;
  const perQuery = opts.perQuery ?? 30;
  const queries: string[] = [];
  // Pair the top topic with the next few for specificity; also one solo top topic.
  queries.push(`topic:${ranked[0]} sort:stars`);
  for (let i = 1; i < ranked.length && queries.length < maxNewQueries; i++) {
    queries.push(`topic:${ranked[0]} topic:${ranked[i]} sort:stars`);
  }

  const results = await Promise.allSettled(
    queries.map((q) => octokit.rest.search.repos({ q, per_page: perQuery, sort: "stars", order: "desc" })),
  );
  const out: Candidate[] = [];
  const seen = new Set<number>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value.data.items as unknown as RepoSearchItem[]) {
      if (item.archived || item.fork || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(toCandidate(item));
    }
  }
  return { candidates: out, topicQueries: queries };
}
