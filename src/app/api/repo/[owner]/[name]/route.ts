import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeResult } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const [snapshot, readme, latestResult] = await Promise.all([
    prisma.repoSnapshot.findFirst({ where: { repoId: repo.id }, orderBy: { fetchedAt: "desc" } }),
    prisma.repoReadme.findFirst({ where: { repoId: repo.id }, orderBy: { fetchedAt: "desc" } }),
    prisma.searchResult.findFirst({
      where: { repoId: repo.id },
      orderBy: { createdAt: "desc" },
      include: { repo: true },
    }),
  ]);

  return NextResponse.json({
    repo: {
      fullName: repo.fullName,
      url: repo.htmlUrl,
      description: repo.description,
      language: repo.primaryLanguage,
      license: repo.licenseSpdx,
      topics: repo.topics,
      isArchived: repo.isArchived,
      createdAt: repo.createdAt,
      pushedAt: repo.pushedAt,
    },
    snapshot,
    readmeExcerpt: readme?.truncatedContent ?? readme?.content ?? null,
    latestResult: latestResult ? serializeResult(latestResult) : null,
  });
}
