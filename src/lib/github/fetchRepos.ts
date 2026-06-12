import { octokit } from "@/lib/github/client";
import type { Candidate } from "@/lib/types";

// Lightweight batched repo-metadata fetch by fullName. Unlike enrich.ts (which
// pulls READMEs, manifests and issue/PR counts for the funnel survivors), this
// fetches only the Candidate-level fields needed to ADD a repo to the candidate
// pool — used by the awesome-list / registry sources whose repos arrive as bare
// "owner/name" strings rather than GitHub search results. One GraphQL round-trip
// per batch of up to 25 repos.

const BATCH_SIZE = 25;

interface LightGraphqlRepo {
  databaseId: number | null;
  nameWithOwner: string;
  owner: { login: string };
  name: string;
  url: string;
  description: string | null;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null } | null;
  repositoryTopics: { nodes: { topic: { name: string } }[] };
  isArchived: boolean;
  isFork: boolean;
  stargazerCount: number;
  forkCount: number;
  watchers: { totalCount: number };
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
}

const LIGHT_FIELDS = `
  fragment LightRepoFields on Repository {
    databaseId
    nameWithOwner
    owner { login }
    name
    url
    description
    primaryLanguage { name }
    licenseInfo { spdxId }
    repositoryTopics(first: 10) { nodes { topic { name } } }
    isArchived
    isFork
    stargazerCount
    forkCount
    watchers { totalCount }
    createdAt
    updatedAt
    pushedAt
  }
`;

function buildBatchQuery(n: number): string {
  const varDecls = Array.from({ length: n }, (_, i) => `$o${i}: String!, $n${i}: String!`).join(", ");
  const blocks = Array.from(
    { length: n },
    (_, i) => `  r${i}: repository(owner: $o${i}, name: $n${i}) { ...LightRepoFields }`,
  ).join("\n");
  return `query FetchReposBatch(${varDecls}) {\n${blocks}\n}\n${LIGHT_FIELDS}`;
}

function toCandidate(repo: LightGraphqlRepo): Candidate | null {
  if (repo.databaseId == null) return null;
  return {
    githubId: repo.databaseId,
    fullName: repo.nameWithOwner,
    owner: repo.owner.login,
    name: repo.name,
    htmlUrl: repo.url,
    description: repo.description,
    primaryLanguage: repo.primaryLanguage?.name ?? null,
    licenseSpdx: repo.licenseInfo?.spdxId ?? null,
    topics: repo.repositoryTopics.nodes.map((n) => n.topic.name),
    isArchived: repo.isArchived,
    isFork: repo.isFork,
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    openIssues: 0, // not fetched at this stage; enrichment fills it for survivors
    watchers: repo.watchers.totalCount,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
  };
}

/**
 * Fetch Candidate metadata for a list of "owner/name" strings. Invalid names,
 * missing repos, archived repos and forks are silently dropped. Errors on a
 * whole batch are non-fatal (GraphQL errors on individual aliases still return
 * the other aliases' data).
 */
export async function fetchCandidatesByName(fullNames: string[]): Promise<Candidate[]> {
  const valid = Array.from(
    new Set(fullNames.map((n) => n.trim()).filter((n) => /^[\w.-]+\/[\w.-]+$/.test(n))),
  );
  if (valid.length === 0) return [];

  const out: Candidate[] = [];
  for (let start = 0; start < valid.length; start += BATCH_SIZE) {
    const batch = valid.slice(start, start + BATCH_SIZE);
    const variables: Record<string, string> = {};
    batch.forEach((fullName, i) => {
      const [owner, name] = fullName.split("/");
      variables[`o${i}`] = owner;
      variables[`n${i}`] = name;
    });
    try {
      const data = await octokit.graphql<Record<string, LightGraphqlRepo | null>>(
        buildBatchQuery(batch.length),
        variables,
      );
      for (const repo of Object.values(data)) {
        if (!repo || repo.isArchived || repo.isFork) continue;
        const candidate = toCandidate(repo);
        if (candidate) out.push(candidate);
      }
    } catch (err: unknown) {
      // octokit.graphql throws GraphqlResponseError when ANY alias is missing,
      // but still carries the partial data for the aliases that resolved.
      const partial = (err as { data?: Record<string, LightGraphqlRepo | null> })?.data;
      if (partial) {
        for (const repo of Object.values(partial)) {
          if (!repo || repo.isArchived || repo.isFork) continue;
          const candidate = toCandidate(repo);
          if (candidate) out.push(candidate);
        }
      } else {
        console.warn("[fetchRepos] batch fetch failed:", err instanceof Error ? err.message : err);
      }
    }
  }
  return out;
}
