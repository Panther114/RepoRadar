import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeResult } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const job = await prisma.searchJob.findFirst({
    where: { searchQueryId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!job) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }

  const query = await prisma.searchQuery.findUnique({ where: { id } });
  const results = await prisma.searchResult.findMany({
    where: { searchQueryId: id },
    orderBy: { rank: "asc" },
    include: { repo: true },
  });

  // Time-anchored progress: the client renders a bar that is linear in elapsed
  // wall-time (elapsed / etaSeconds), not in pipeline stage. `startedAt` is the
  // server's job-creation timestamp so the elapsed clock is independent of when
  // the user opened the page; `etaSeconds` is the calibrated typical cold-search
  // duration. The stage label still drives the textual step indicator.
  const etaSeconds = Number(process.env.SEARCH_ETA_SECONDS) || 67;

  return NextResponse.json({
    searchId: id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    startedAt: job.createdAt?.toISOString() ?? null,
    finishedAt:
      job.status === "completed" || job.status === "failed"
        ? job.updatedAt?.toISOString() ?? null
        : null,
    etaSeconds,
    prompt: query?.rawPrompt ?? null,
    constraints: query?.extractedConstraints ?? null,
    results: results.map(serializeResult),
  });
}
