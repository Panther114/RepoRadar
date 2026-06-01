import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Analysis, Candidate, RepoEvidence } from "@/lib/types";

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Enrichment cache ───────────────────────────────────────────────────────
// The expensive GitHub-derived evidence, minus the volatile bits (the live
// candidate + per-search similarity) which are merged back in on read.
export type CachedEvidence = Omit<RepoEvidence, "candidate" | "similarity">;

/** Load fresh (within TTL) cached enrichment for the given repo UUIDs. */
export async function loadEnrichmentCache(
  repoIds: string[],
  ttlMs: number,
): Promise<Map<string, CachedEvidence>> {
  const out = new Map<string, CachedEvidence>();
  if (repoIds.length === 0) return out;
  const cutoff = new Date(Date.now() - ttlMs);
  const rows = await prisma.repoEnrichment.findMany({
    where: { repoId: { in: repoIds }, enrichedAt: { gte: cutoff } },
    select: { repoId: true, evidenceJson: true },
  });
  for (const row of rows) {
    out.set(row.repoId, row.evidenceJson as unknown as CachedEvidence);
  }
  return out;
}

/** Upsert the cached enrichment evidence for a repo. */
export async function saveEnrichmentCache(repoId: string, e: RepoEvidence): Promise<void> {
  const cached: CachedEvidence = {
    readme: e.readme,
    readmeHash: e.readmeHash,
    manifests: e.manifests,
    releaseCount: e.releaseCount,
    latestReleaseAt: e.latestReleaseAt,
    releasesLast90: e.releasesLast90,
    releasesLast365: e.releasesLast365,
    hasChangelog: e.hasChangelog,
    openIssues: e.openIssues,
    closedIssues: e.closedIssues,
    openPRs: e.openPRs,
    mergedPRs: e.mergedPRs,
    contributorCount: e.contributorCount,
    isOrgOwned: e.isOrgOwned,
    docsSignals: e.docsSignals,
  };
  const json = cached as unknown as Prisma.InputJsonValue;
  await prisma.repoEnrichment.upsert({
    where: { repoId },
    create: { repoId, evidenceJson: json },
    update: { evidenceJson: json, enrichedAt: new Date() },
  });
}

/** Upsert the repo row (keyed by GitHub id) and return its UUID. */
export async function upsertRepo(c: Candidate): Promise<string> {
  const data = {
    githubId: BigInt(c.githubId),
    fullName: c.fullName,
    owner: c.owner,
    name: c.name,
    htmlUrl: c.htmlUrl,
    description: c.description,
    primaryLanguage: c.primaryLanguage,
    licenseSpdx: c.licenseSpdx,
    topics: c.topics,
    isArchived: c.isArchived,
    isFork: c.isFork,
    createdAt: toDate(c.createdAt),
    updatedAt: toDate(c.updatedAt),
    pushedAt: toDate(c.pushedAt),
    fetchedAt: new Date(),
  };
  const repo = await prisma.repo.upsert({
    where: { githubId: BigInt(c.githubId) },
    create: data,
    update: data,
    select: { id: true },
  });
  return repo.id;
}

/** Store a metrics snapshot for a repo. */
export async function saveSnapshot(repoId: string, c: Candidate): Promise<void> {
  await prisma.repoSnapshot.create({
    data: {
      repoId,
      stars: c.stars,
      forks: c.forks,
      watchers: c.watchers,
      openIssues: c.openIssues,
    },
  });
}

/** Store the (truncated) README + content hash. */
export async function saveReadme(repoId: string, e: RepoEvidence): Promise<void> {
  if (!e.readme) return;
  await prisma.repoReadme.create({
    data: {
      repoId,
      content: e.readme,
      contentHash: e.readmeHash,
      truncatedContent: e.readme,
    },
  });
}

// ── Candidate-search cache ─────────────────────────────────────────────────

/** Return cached candidates for a query hash if present and within TTL. */
export async function loadCandidateCache(
  queryHash: string,
  ttlMs: number,
): Promise<Candidate[] | null> {
  const cutoff = new Date(Date.now() - ttlMs);
  const row = await prisma.searchCandidateCache.findFirst({
    where: { queryHash, createdAt: { gte: cutoff } },
    select: { candidatesJson: true },
  });
  return row ? (row.candidatesJson as unknown as Candidate[]) : null;
}

/** Upsert the candidate list for a query hash. */
export async function saveCandidateCache(queryHash: string, candidates: Candidate[]): Promise<void> {
  const json = candidates as unknown as Prisma.InputJsonValue;
  await prisma.searchCandidateCache.upsert({
    where: { queryHash },
    create: { queryHash, candidatesJson: json },
    update: { candidatesJson: json, createdAt: new Date() },
  });
}

/** Persist a scored result row. `scoreBreakdown` carries everything the UI needs. */
export async function saveResult(args: {
  searchQueryId: string;
  repoId: string;
  rank: number;
  analysis: Analysis;
  evidence: RepoEvidence;
}): Promise<void> {
  const { analysis: a, evidence: e } = args;
  await prisma.searchResult.create({
    data: {
      searchQueryId: args.searchQueryId,
      repoId: args.repoId,
      rank: args.rank,
      fitScore: a.fit,
      futureScore: a.future,
      underratedScore: a.underrated,
      totalScore: a.total,
      scoreBreakdown: {
        analysis: a,
        metrics: {
          stars: e.candidate.stars,
          forks: e.candidate.forks,
          openIssues: e.openIssues,
          closedIssues: e.closedIssues,
          mergedPRs: e.mergedPRs,
          contributors: e.contributorCount,
          releaseCount: e.releaseCount,
          releasesLast90: e.releasesLast90,
          latestReleaseAt: e.latestReleaseAt,
          pushedAt: e.candidate.pushedAt,
          createdAt: e.candidate.createdAt,
        },
        repo: {
          fullName: e.candidate.fullName,
          url: e.candidate.htmlUrl,
          description: e.candidate.description,
          language: e.candidate.primaryLanguage,
          license: e.candidate.licenseSpdx,
          topics: e.candidate.topics,
        },
        docs: e.docsSignals,
        similarity: e.similarity,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}
