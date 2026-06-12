import { octokit } from "@/lib/github/client";
import { detectReferences } from "@/lib/search/referenceDetect";
import type { Candidate } from "@/lib/types";

export { detectReferences };

// Reference resolution (v1.1.4): the transition layer between the user's
// wording and query generation for prompts that DEFINE the target by pointing
// at another project — "alternative to X", "like X", "X clone". The literal
// words of such a prompt carry almost no domain signal ("open source
// alternative to firebase" contains neither "backend" nor "auth" nor
// "realtime database"), so keyword/embedding search built from the prompt text
// alone systematically under-performs. Resolving X to its actual GitHub repo
// gives us:
//   1. an ANCHOR TEXT (X's description + topics) that injects the missing
//      domain vocabulary into the intent embedding,
//   2. high-precision queries (GitHub convention: `topic:<x>-alternative`
//      exists for most major projects, plus X's own topics),
//   3. an EXCLUSION — the referenced project itself must not be a result.

export interface ReferenceContext {
  /** The resolved repos the user pointed at. */
  referenced: Candidate[];
  /** Domain vocabulary from the referenced repos, for the intent embedding. */
  anchorText: string;
  /** High-precision queries derived from the referenced repos. */
  refQueries: string[];
  /** fullNames (lowercase) to exclude from results — the referenced project itself. */
  excludeFullNames: string[];
}

export function referenceResolveEnabled(): boolean {
  return String(process.env.REF_RESOLVE ?? "true").toLowerCase() === "true";
}

interface SearchItem {
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

function toCandidate(item: SearchItem): Candidate {
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
 * Resolve a referenced project name to its most-likely GitHub repo: search by
 * name sorted by stars and prefer an exact name (or owner) match. Returns null
 * when nothing plausible is found — better no anchor than a wrong one.
 */
async function resolveOne(name: string): Promise<Candidate | null> {
  const slug = name.replace(/\s+/g, "-");
  try {
    const res = await octokit.rest.search.repos({
      q: `${name} in:name`,
      sort: "stars",
      order: "desc",
      per_page: 5,
    });
    const items = res.data.items as unknown as SearchItem[];
    // Only an EXACT repo-name match counts ("supabase/supabase" for
    // "supabase"). Looser tiers (name-contains, owner-equals, top-stars) all
    // misfired in eval — "firebase" → invertase/react-native-firebase,
    // "google analytics" → an MCP server — and a wrong anchor/exclusion is
    // strictly worse than none. Closed-platform references (firebase, notion,
    // airtable) intentionally resolve to null: the name-derived queries that
    // don't need resolution still fire for them.
    const nameEq = items.find((it) => it.name.toLowerCase() === slug);
    if (!nameEq || nameEq.stargazers_count < 1000) return null;
    return toCandidate(nameEq);
  } catch {
    return null;
  }
}

/**
 * Build the full reference context for a prompt: detect references, resolve
 * them on GitHub, and derive anchor text + queries + exclusions. Resolves to
 * null when the prompt doesn't reference another project (the common case) —
 * callers treat null as "feature inactive for this query". `extraNames` lets
 * the LLM intent pass contribute references the regexes missed.
 */
export async function buildReferenceContext(
  prompt: string,
  extraNames: string[] = [],
): Promise<ReferenceContext | null> {
  if (!referenceResolveEnabled()) return null;
  const names = Array.from(
    new Set([...detectReferences(prompt), ...extraNames.map((n) => n.toLowerCase().trim())].filter(Boolean)),
  ).slice(0, 2);
  if (names.length === 0) return null;

  // The high-value queries derive from the NAME alone — no resolution needed,
  // so they also work for closed platforms (firebase, notion) that have no
  // canonical GitHub repo. In eval, "<x> alternative" under sort:stars was the
  // single best query for alternative-prompts (surfaced supabase, nhost,
  // trailbase, bknd). Capped at 2 so they displace at most 2 LLM queries.
  const primary = names[0];
  const refQueries = [
    `topic:${primary.replace(/\s+/g, "-")}-alternative`,
    `${primary} alternative`,
  ];

  // Resolution (exact-name only) adds the optional extras: anchor text for the
  // intent embedding and self-exclusion. A failed resolution costs nothing.
  const resolved = (await Promise.all(names.map(resolveOne))).filter(
    (c): c is Candidate => c !== null,
  );
  const anchorText = resolved
    .map((repo) => [repo.description ?? "", repo.topics.join(" ")].filter(Boolean).join(". "))
    .join(". ")
    .slice(0, 600);

  return {
    referenced: resolved,
    anchorText,
    refQueries,
    excludeFullNames: resolved.map((repo) => repo.fullName.toLowerCase()),
  };
}
