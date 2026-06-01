import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalysisBreakdown {
  analysis?: {
    fitComponents?: Record<string, number>;
    futureComponents?: Record<string, number>;
  };
  metrics?: {
    releaseCount?: number;
    releasesLast90?: number;
    releasesLast365?: number;
    latestReleaseAt?: string | null;
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await ctx.params;
  const fullName = `${owner}/${name}`;

  const repo = await prisma.repo.findUnique({ where: { fullName } });
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const snapshots = await prisma.repoSnapshot.findMany({
    where: { repoId: repo.id },
    orderBy: { fetchedAt: "asc" },
  });
  const latest = await prisma.searchResult.findFirst({
    where: { repoId: repo.id },
    orderBy: { createdAt: "desc" },
  });

  const breakdown = (latest?.scoreBreakdown ?? {}) as AnalysisBreakdown;
  const fitC = breakdown.analysis?.fitComponents ?? {};
  const futureC = breakdown.analysis?.futureComponents ?? {};

  // Star/fork trend comes from the metrics snapshots we've captured over time.
  const starTrend = snapshots.map((s) => ({
    date: s.fetchedAt,
    stars: s.stars ?? 0,
    forks: s.forks ?? 0,
    openIssues: s.openIssues ?? 0,
  }));

  // Score radar: pair fit + future components by a shared label set.
  const radar = [
    { axis: "Activity", value: futureC.recent_activity ?? 0 },
    { axis: "Releases", value: futureC.release_cadence ?? 0 },
    { axis: "Issues/PRs", value: futureC.issue_pr_health ?? 0 },
    { axis: "Contributors", value: futureC.contributor_health ?? 0 },
    { axis: "Docs", value: futureC.documentation_quality ?? 0 },
    { axis: "Ecosystem", value: futureC.ecosystem_signal ?? 0 },
  ];
  const fitRadar = [
    { axis: "Semantic", value: fitC.semantic_similarity ?? 0 },
    { axis: "Features", value: fitC.explicit_feature_match ?? 0 },
    { axis: "Lang/FW", value: fitC.language_framework_match ?? 0 },
    { axis: "Manifest", value: fitC.package_manifest_match ?? 0 },
    { axis: "Constraints", value: fitC.constraint_satisfaction ?? 0 },
    { axis: "Type", value: fitC.repository_type_match ?? 0 },
  ];

  return NextResponse.json({
    fullName,
    starTrend,
    radar,
    fitRadar,
    releases: {
      total: breakdown.metrics?.releaseCount ?? 0,
      last90: breakdown.metrics?.releasesLast90 ?? 0,
      last365: breakdown.metrics?.releasesLast365 ?? 0,
      latest: breakdown.metrics?.latestReleaseAt ?? null,
    },
  });
}
