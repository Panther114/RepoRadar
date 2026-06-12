import { octokit } from "@/lib/github/client";

// Awesome-list mining (v1.1.4): `awesome-<topic>` lists are HUMAN-CURATED
// catalogues of the genuinely useful repos in a domain — the strongest
// relevance prior available for free. We find the best-matching lists for the
// query's domain keywords, extract the repos they link, and return them as
//   1. a candidate source (repos the keyword/embedding search may have missed),
//   2. a curated-membership set the funnel can use as a quality boost.

export interface AwesomeMineResult {
  /** "owner/name" strings linked from the mined lists, in document order. */
  curatedNames: string[];
  /** The lists that were mined (for diagnostics). */
  lists: string[];
}

export function awesomeListsEnabled(): boolean {
  return String(process.env.AWESOME_LISTS ?? "true").toLowerCase() === "true";
}

const MAX_LISTS = 2;
const MIN_LIST_STARS = 200;
const MAX_CURATED = 150;

// Link targets that are never project repos (badges, profiles, site chrome).
const LINK_BLOCKLIST = new Set([
  "sponsors", "topics", "features", "about", "contact", "pricing", "site",
  "orgs", "apps", "marketplace", "collections", "trending", "settings",
]);

function extractRepoLinks(markdown: string, selfFullName: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([selfFullName.toLowerCase()]);
  const re = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:[/#?)\s"']|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null && out.length < MAX_CURATED) {
    const owner = m[1];
    const name = m[2].replace(/\.git$/, "");
    if (LINK_BLOCKLIST.has(owner.toLowerCase())) continue;
    // Badge/CI image paths sneak in as repo-shaped links; the common ones have
    // tell-tale owners. Anything that survives still gets validated by the
    // GraphQL fetch (missing repos drop out there).
    if (/^(shields|badge|img|raw|gist|codecov|travis|circleci|actions)$/i.test(owner)) continue;
    const fullName = `${owner}/${name}`;
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fullName);
  }
  return out;
}

interface ListSearchItem {
  full_name: string;
  name: string;
  stargazers_count: number;
  archived: boolean;
  fork: boolean;
}

/**
 * Find the top awesome lists for the query's domain keywords and return the
 * repos they link. Network cost: 1 search + up to MAX_LISTS readme fetches.
 * All failures are non-fatal (returns what was mined so far).
 */
export async function mineAwesomeLists(keywords: string[]): Promise<AwesomeMineResult> {
  const empty: AwesomeMineResult = { curatedNames: [], lists: [] };
  if (!awesomeListsEnabled()) return empty;

  const domainKws = keywords.filter((k) => k.trim()).slice(0, 3);
  if (domainKws.length === 0) return empty;

  let lists: ListSearchItem[];
  try {
    const res = await octokit.rest.search.repos({
      q: `awesome ${domainKws.join(" ")} in:name`,
      sort: "stars",
      order: "desc",
      per_page: 10,
    });
    lists = (res.data.items as unknown as ListSearchItem[])
      .filter(
        (it) =>
          !it.archived &&
          !it.fork &&
          it.stargazers_count >= MIN_LIST_STARS &&
          /^awesome[-_.]/i.test(it.name), // real awesome-* list, not a repo that merely says "awesome"
      )
      .slice(0, MAX_LISTS);
  } catch {
    return empty;
  }
  if (lists.length === 0) return empty;

  const curated: string[] = [];
  const seen = new Set<string>();
  await Promise.all(
    lists.map(async (list) => {
      try {
        const [owner, repo] = list.full_name.split("/");
        const readme = await octokit.rest.repos.getReadme({
          owner,
          repo,
          mediaType: { format: "raw" },
        });
        const md = readme.data as unknown as string;
        for (const fullName of extractRepoLinks(md, list.full_name)) {
          const key = fullName.toLowerCase();
          if (seen.has(key) || curated.length >= MAX_CURATED) continue;
          seen.add(key);
          curated.push(fullName);
        }
      } catch {
        /* single list failing is fine */
      }
    }),
  );

  return { curatedNames: curated, lists: lists.map((l) => l.full_name) };
}
