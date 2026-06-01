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

  return NextResponse.json({
    searchId: id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    prompt: query?.rawPrompt ?? null,
    constraints: query?.extractedConstraints ?? null,
    results: results.map(serializeResult),
  });
}
