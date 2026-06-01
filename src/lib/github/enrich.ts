import { octokit } from "@/lib/github/client";
import { sha256 } from "@/lib/cache/keys";
import type { Candidate, ManifestInfo, RepoEvidence } from "@/lib/types";

const README_MAX = 6000;

/** Truncate a README keeping the head and section headings. */
function structuredTruncate(md: string, max = README_MAX): string {
  if (md.length <= max) return md;
  const head = md.slice(0, Math.floor(max * 0.7));
  const headings = (md.match(/^#{1,3}\s.+$/gm) ?? []).slice(0, 40).join("\n");
  return `${head}\n\n[...truncated...]\n\nSection headings:\n${headings}`.slice(0, max);
}

function decodeBase64(content: string): string {
  return Buffer.from(content, "base64").toString("utf-8");
}

// ---------------------------------------------------------------------------
// GraphQL — a single shared fragment used for both the single-repo query and
// the batched multi-repo query (one round-trip for the whole funnel).
// ---------------------------------------------------------------------------

const REPO_FIELDS = `
  fragment RepoFields on Repository {
    homepageUrl
    owner { __typename }
    openIssueCount:   issues(states: OPEN)        { totalCount }
    closedIssueCount: issues(states: CLOSED)      { totalCount }
    openPRCount:      pullRequests(states: OPEN)   { totalCount }
    mergedPRCount:    pullRequests(states: MERGED) { totalCount }
    mentionableUsers(first: 1)                     { totalCount }
    releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
      totalCount
      nodes { publishedAt }
    }
    defaultBranchRef { target { ... on Commit { tree { entries { name } } } } }
    readmeMd:    object(expression: "HEAD:README.md")  { ... on Blob { text } }
    readmeLower: object(expression: "HEAD:readme.md")  { ... on Blob { text } }
    readmeRst:   object(expression: "HEAD:README.rst") { ... on Blob { text } }
    readmeTxt:   object(expression: "HEAD:README.txt") { ... on Blob { text } }
    readmePlain: object(expression: "HEAD:README")     { ... on Blob { text } }
    packageJson:     object(expression: "HEAD:package.json")     { ... on Blob { text } }
    pyprojectToml:   object(expression: "HEAD:pyproject.toml")   { ... on Blob { text } }
    requirementsTxt: object(expression: "HEAD:requirements.txt") { ... on Blob { text } }
    cargoToml:       object(expression: "HEAD:Cargo.toml")       { ... on Blob { text } }
    goMod:           object(expression: "HEAD:go.mod")           { ... on Blob { text } }
    pomXml:          object(expression: "HEAD:pom.xml")          { ... on Blob { text } }
    buildGradle:     object(expression: "HEAD:build.gradle")     { ... on Blob { text } }
  }
`;

const SINGLE_QUERY = `
  query EnrichRepo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { ...RepoFields }
  }
  ${REPO_FIELDS}
`;

/** Build a batched query that fetches N repos in one request via aliases. */
function buildBatchQuery(n: number): string {
  const varDecls = Array.from({ length: n }, (_, i) => `$o${i}: String!, $n${i}: String!`).join(", ");
  const blocks = Array.from(
    { length: n },
    (_, i) => `    r${i}: repository(owner: $o${i}, name: $n${i}) { ...RepoFields }`,
  ).join("\n");
  return `query EnrichBatch(${varDecls}) {\n${blocks}\n}\n${REPO_FIELDS}`;
}

interface GraphqlBlob {
  text: string | null;
}
interface GraphqlRepo {
  homepageUrl: string | null;
  owner: { __typename: string };
  openIssueCount: { totalCount: number };
  closedIssueCount: { totalCount: number };
  openPRCount: { totalCount: number };
  mergedPRCount: { totalCount: number };
  mentionableUsers: { totalCount: number };
  releases: { totalCount: number; nodes: { publishedAt: string | null }[] };
  defaultBranchRef: { target: { tree: { entries: { name: string }[] } } | null } | null;
  readmeMd: GraphqlBlob | null;
  readmeLower: GraphqlBlob | null;
  readmeRst: GraphqlBlob | null;
  readmeTxt: GraphqlBlob | null;
  readmePlain: GraphqlBlob | null;
  packageJson: GraphqlBlob | null;
  pyprojectToml: GraphqlBlob | null;
  requirementsTxt: GraphqlBlob | null;
  cargoToml: GraphqlBlob | null;
  goMod: GraphqlBlob | null;
  pomXml: GraphqlBlob | null;
  buildGradle: GraphqlBlob | null;
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

function extractReadme(repo: GraphqlRepo): { content: string | null; hash: string | null; length: number } {
  const raw =
    repo.readmeMd?.text ??
    repo.readmeLower?.text ??
    repo.readmeRst?.text ??
    repo.readmeTxt?.text ??
    repo.readmePlain?.text ??
    null;
  if (!raw) return { content: null, hash: null, length: 0 };
  return { content: structuredTruncate(raw), hash: sha256(raw), length: raw.length };
}

const MANIFEST_MAP: Record<string, { key: keyof GraphqlRepo; ecosystem: string }> = {
  "package.json": { key: "packageJson", ecosystem: "npm" },
  "pyproject.toml": { key: "pyprojectToml", ecosystem: "pypi" },
  "requirements.txt": { key: "requirementsTxt", ecosystem: "pypi" },
  "Cargo.toml": { key: "cargoToml", ecosystem: "cargo" },
  "go.mod": { key: "goMod", ecosystem: "go" },
  "pom.xml": { key: "pomXml", ecosystem: "maven" },
  "build.gradle": { key: "buildGradle", ecosystem: "gradle" },
};

function extractManifests(repo: GraphqlRepo): ManifestInfo[] {
  const out: ManifestInfo[] = [];
  for (const [file, { key, ecosystem }] of Object.entries(MANIFEST_MAP)) {
    const blob = repo[key] as GraphqlBlob | null;
    if (!blob?.text) continue;
    let packageName: string | null = null;
    let dependencyCount: number | null = null;
    if (file === "package.json") {
      try {
        const json = JSON.parse(blob.text) as {
          name?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        packageName = json.name ?? null;
        dependencyCount =
          Object.keys(json.dependencies ?? {}).length +
          Object.keys(json.devDependencies ?? {}).length;
      } catch {
        /* ignore malformed manifest */
      }
    }
    out.push({ file, ecosystem, packageName, dependencyCount, hasDeps: blob.text.trim().length > 0 });
  }
  return out;
}

function extractReleases(releases: GraphqlRepo["releases"]) {
  const now = Date.now();
  const dates = releases.nodes
    .map((r) => (r.publishedAt ? new Date(r.publishedAt).getTime() : 0))
    .filter((t) => t > 0)
    .sort((a, b) => b - a);
  const within = (days: number) => dates.filter((t) => now - t <= days * 86_400_000).length;
  return {
    releaseCount: releases.totalCount,
    latestReleaseAt: dates[0] ? new Date(dates[0]).toISOString() : null,
    releasesLast90: within(90),
    releasesLast365: within(365),
  };
}

/** Assemble a RepoEvidence from a GraphQL repository node. */
function buildEvidence(repo: GraphqlRepo, candidate: Candidate, similarity: number): RepoEvidence {
  const readme = extractReadme(repo);
  const manifests = extractManifests(repo);
  const releases = extractReleases(repo.releases);

  const rootEntries = repo.defaultBranchRef?.target?.tree?.entries?.map((e) => e.name) ?? [];
  const lowerEntries = rootEntries.map((e) => e.toLowerCase());
  const has = (pred: (e: string) => boolean) => lowerEntries.some(pred);
  const readmeText = readme.content ?? "";

  return {
    candidate,
    readme: readme.content,
    readmeHash: readme.hash,
    manifests,
    releaseCount: releases.releaseCount,
    latestReleaseAt: releases.latestReleaseAt,
    releasesLast90: releases.releasesLast90,
    releasesLast365: releases.releasesLast365,
    hasChangelog: has((e) => e.startsWith("changelog")),
    openIssues: candidate.openIssues,
    closedIssues: repo.closedIssueCount.totalCount,
    openPRs: repo.openPRCount.totalCount,
    mergedPRs: repo.mergedPRCount.totalCount,
    contributorCount: repo.mentionableUsers.totalCount,
    isOrgOwned: repo.owner.__typename === "Organization",
    docsSignals: {
      hasInstall: /(^|\n)#{1,4}\s*.*install/i.test(readmeText),
      hasQuickstart: /(quick\s?start|getting started|usage)/i.test(readmeText),
      hasExamples: has((e) => e === "examples" || e === "example") || /example/i.test(readmeText),
      hasApiDocs: /(api reference|api docs|\bapi\b)/i.test(readmeText),
      hasDocsFolder: has((e) => e === "docs" || e === "documentation"),
      hasWebsite: !!repo.homepageUrl && repo.homepageUrl.length > 0,
      readmeLength: readme.length,
    },
    similarity,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 15;
const DEFAULT_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} after ${ms}ms`)), ms)),
  ]);
}

/**
 * Enrich many survivors in as few round-trips as possible. Instead of firing one
 * GraphQL request per repo (which GitHub throttles when many run concurrently),
 * this batches up to BATCH_SIZE repos into a single aliased query. Partial
 * GraphQL errors (e.g. a repo renamed between search and enrich) are tolerated:
 * present repos use the returned data, missing ones get the cheap fallback.
 */
export async function enrichReposBatch(
  items: { candidate: Candidate; similarity: number }[],
  opts: { chunkSize?: number; timeoutMs?: number } = {},
): Promise<RepoEvidence[]> {
  if (items.length === 0) return [];
  const chunkSize = opts.chunkSize ?? (Number(process.env.ENRICH_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.ENRICH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

  const results: RepoEvidence[] = new Array(items.length);

  // Process chunks concurrently — each chunk is a single round-trip, so a small
  // number of chunks (1–2 for a normal funnel) does not trigger throttling.
  const chunks: { items: typeof items; base: number }[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push({ items: items.slice(i, i + chunkSize), base: i });
  }

  await Promise.all(
    chunks.map(async ({ items: chunk, base }) => {
      const query = buildBatchQuery(chunk.length);
      const variables: Record<string, string> = {};
      chunk.forEach((it, i) => {
        variables[`o${i}`] = it.candidate.owner;
        variables[`n${i}`] = it.candidate.name;
      });

      let data: Record<string, GraphqlRepo | null> | undefined;
      try {
        data = await withTimeout(
          octokit.graphql<Record<string, GraphqlRepo | null>>(query, variables),
          timeoutMs,
          "GraphQL batch timeout",
        );
      } catch (err) {
        // GraphQL may return partial data alongside errors (e.g. one NOT_FOUND).
        const partial = (err as { data?: Record<string, GraphqlRepo | null> })?.data;
        if (partial && Object.keys(partial).some((k) => k.startsWith("r"))) {
          data = partial;
        } else {
          console.warn(`[enrich] batch failed (${chunk.length} repos), per-repo fallback:`, err);
        }
      }

      // If the batch yielded no usable data (timeout / non-partial error / null
      // response), fall back to per-repo enrichment for the whole chunk. This
      // guard is critical: without it, `data[`r${i}`]` below throws on undefined
      // and rejects the entire Promise.all, failing the whole search.
      if (!data) {
        const fb = await Promise.all(chunk.map((it) => enrichRepo(it.candidate, it.similarity)));
        fb.forEach((ev, i) => (results[base + i] = ev));
        return;
      }

      for (let i = 0; i < chunk.length; i++) {
        const repo = data[`r${i}`] ?? null;
        results[base + i] = repo
          ? buildEvidence(repo, chunk[i].candidate, chunk[i].similarity)
          : await enrichRepoMinimal(chunk[i].candidate, chunk[i].similarity);
      }
    }),
  );

  return results;
}

/** Enrich a single repo (used as a fallback inside the batch path). */
export async function enrichRepo(candidate: Candidate, similarity: number): Promise<RepoEvidence> {
  const { owner, name } = candidate;
  const timeoutMs = Number(process.env.ENRICH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  try {
    const gql = await withTimeout(
      octokit.graphql<{ repository: GraphqlRepo | null }>(SINGLE_QUERY, { owner, name }),
      timeoutMs,
      "GraphQL timeout",
    );
    if (!gql.repository) throw new Error("GraphQL returned null repository");
    return buildEvidence(gql.repository, candidate, similarity);
  } catch (gqlErr) {
    console.warn(`[enrich] GraphQL failed for ${candidate.fullName}, minimal fallback:`, gqlErr);
    return enrichRepoMinimal(candidate, similarity);
  }
}

async function fetchReadmeRest(owner: string, name: string) {
  try {
    const res = await octokit.rest.repos.getReadme({ owner, repo: name });
    const raw = decodeBase64(res.data.content);
    return { content: structuredTruncate(raw), hash: sha256(raw), length: raw.length };
  } catch {
    return { content: null, hash: null, length: 0 };
  }
}

/**
 * Cheap fallback: no heavy API calls. Uses the candidate metadata we already
 * have from search plus one best-effort README fetch. Health/activity counts are
 * left at 0 (the deterministic scorer degrades gracefully). Caps worst-case
 * enrichment near the timeout instead of compounding it with more requests.
 */
async function enrichRepoMinimal(candidate: Candidate, similarity: number): Promise<RepoEvidence> {
  const readme = await fetchReadmeRest(candidate.owner, candidate.name).catch(() => ({
    content: null,
    hash: null,
    length: 0,
  }));
  const readmeText = readme.content ?? "";
  return {
    candidate,
    readme: readme.content,
    readmeHash: readme.hash,
    manifests: [],
    releaseCount: 0,
    latestReleaseAt: null,
    releasesLast90: 0,
    releasesLast365: 0,
    hasChangelog: false,
    openIssues: candidate.openIssues,
    closedIssues: 0,
    openPRs: 0,
    mergedPRs: 0,
    contributorCount: 0,
    isOrgOwned: false,
    docsSignals: {
      hasInstall: /(^|\n)#{1,4}\s*.*install/i.test(readmeText),
      hasQuickstart: /(quick\s?start|getting started|usage)/i.test(readmeText),
      hasExamples: /example/i.test(readmeText),
      hasApiDocs: /(api reference|api docs|\bapi\b)/i.test(readmeText),
      hasDocsFolder: false,
      hasWebsite: false,
      readmeLength: readme.length,
    },
    similarity,
  };
}
