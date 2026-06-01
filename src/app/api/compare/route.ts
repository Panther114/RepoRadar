import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { serializeResult } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fullNames: z.array(z.string()).min(2).max(5),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide 2-5 repo fullNames" }, { status: 400 });
  }

  const repos = await prisma.repo.findMany({
    where: { fullName: { in: parsed.data.fullNames } },
  });

  const results = await Promise.all(
    repos.map(async (repo) => {
      const latest = await prisma.searchResult.findFirst({
        where: { repoId: repo.id },
        orderBy: { createdAt: "desc" },
        include: { repo: true },
      });
      return latest ? serializeResult(latest) : null;
    }),
  );

  return NextResponse.json({ results: results.filter(Boolean) });
}
