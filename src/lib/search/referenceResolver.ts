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
    // Match precision tiers (items are star-sorted, so first hit = most famous):
    //   1. repo NAME equals the reference ("supabase/supabase" for "supabase"),
    //   2. repo name CONTAINS it ("firebase-js-sdk" for "firebase" — common for
    //      orgs whose product repo isn't named exactly after the product),
    //   3. OWNER equals it (last resort: org match alone can pick an arbitrary
    //      popular repo of that org, e.g. firebase/functions-samples),
    //   4. top result, only if prominent enough to plausibly be "the" project.
    const nameEq = items.find((it) => it.name.toLowerCase() === slug);
    const nameHas = items.find((it) => it.name.toLowerCase().includes(slug));
    const ownerEq = items.find((it) => it.owner?.login.toLowerCase() === slug);
    const matched = nameEq ?? nameHas ?? ownerEq;
    const best = matched ?? items[0];
    if (!best) return null;
    if (!matched && best.stargazers_count < 1000) return null; // too obscure to be a famous reference
    return toCandidate(best);
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

  const resolved = (await Promise.all(names.map(resolveOne))).filter(
    (c): c is Candidate => c !== null,
  );
  if (resolved.length === 0) return null;

  const refQueries: string[] = [];
  const anchorParts: string[] = [];
  const exclude: string[] = [];

  for (let i = 0; i < resolved.length; i++) {
    const repo = resolved[i];
    const refName = names[i] ?? repo.name.toLowerCase();
    const slug = refName.replace(/\s+/g, "-");

    // GitHub convention: alternatives tag themselves `topic:<x>-alternative`.
    refQueries.push(`topic:${slug}-alternative`);
    refQueries.push(`${refName} alternative`);

    // The referenced repo's own topics describe the DOMAIN — query by the most
    // specific ones (skip the project's own name; it would just re-find it).
    const domainTopics = repo.topics
      .filter((t) => !t.includes(slug) && !slug.includes(t))
      .slice(0, 3);
    if (domainTopics.length >= 2) {
      refQueries.push(domainTopics.map((t) => `topic:${t}`).join(" "));
    }

    anchorParts.push([repo.description ?? "", repo.topics.join(" ")].filter(Boolean).join(". "));
    exclude.push(repo.fullName.toLowerCase());
  }

  return {
    referenced: resolved,
    anchorText: anchorParts.join(". ").slice(0, 600),
    refQueries: Array.from(new Set(refQueries)).slice(0, 4),
    excludeFullNames: exclude,
  };
}
