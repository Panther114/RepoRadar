// Package-registry candidate source (v1.1.4): npm and crates.io expose free,
// unauthenticated search APIs whose ranking blends popularity, maintenance and
// text relevance — an independent signal from GitHub search. Each hit links
// back to its GitHub repo, giving us candidates that GitHub's own "best match"
// ordering may bury (registry search is package-name/description-centric and
// download-weighted). Only the registry matching the language context is
// queried, and everything is best-effort with a short timeout.

export function registrySourcesEnabled(): boolean {
  return String(process.env.REGISTRY_SOURCES ?? "true").toLowerCase() === "true";
}

const TIMEOUT_MS = 4_000;
const MAX_PER_REGISTRY = 15;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": "RepoRadar" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** "https://github.com/owner/repo(.git)" → "owner/repo", else null. */
function githubFullName(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

interface NpmSearchResponse {
  objects?: { package?: { links?: { repository?: string } } }[];
}

async function searchNpm(query: string): Promise<string[]> {
  const data = (await getJson(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${MAX_PER_REGISTRY}`,
  )) as NpmSearchResponse;
  return (data.objects ?? [])
    .map((o) => githubFullName(o.package?.links?.repository))
    .filter((n): n is string => n !== null);
}

interface CratesSearchResponse {
  crates?: { repository?: string | null }[];
}

async function searchCrates(query: string): Promise<string[]> {
  const data = (await getJson(
    `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=${MAX_PER_REGISTRY}`,
  )) as CratesSearchResponse;
  return (data.crates ?? [])
    .map((c) => githubFullName(c.repository))
    .filter((n): n is string => n !== null);
}

// PyPI is intentionally absent: it has no JSON search API (XML-RPC search was
// deprecated), so Python queries rely on GitHub search + awesome lists alone.

/**
 * Query the registries that match the language context with the query's core
 * keywords; return GitHub "owner/name" strings in registry-rank order.
 * Failures (timeouts, rate limits) degrade to an empty list.
 */
export async function searchRegistries(
  keywords: string[],
  language: string | null,
): Promise<string[]> {
  if (!registrySourcesEnabled()) return [];
  const query = keywords.filter(Boolean).slice(0, 3).join(" ").trim();
  if (!query) return [];

  const lang = language?.toLowerCase() ?? null;
  const tasks: Promise<string[]>[] = [];
  // npm covers the JS/TS ecosystem and is also the default when no language is
  // specified (the most common case for web-flavoured queries). crates.io only
  // when the query is explicitly Rust.
  if (lang === null || lang === "javascript" || lang === "typescript") {
    tasks.push(searchNpm(query).catch(() => []));
  }
  if (lang === null || lang === "rust") {
    tasks.push(searchCrates(query).catch(() => []));
  }
  if (tasks.length === 0) return [];

  const results = await Promise.all(tasks);
  const out: string[] = [];
  const seen = new Set<string>();
  // Interleave registries so neither dominates the head of the list.
  for (let i = 0; i < MAX_PER_REGISTRY; i++) {
    for (const list of results) {
      const name = list[i];
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}
