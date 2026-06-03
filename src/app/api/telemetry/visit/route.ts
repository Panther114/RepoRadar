import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  visitorId: z.string().min(8),
  path: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
  userAgent: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid telemetry payload" }, { status: 400 });
  }

  const { visitorId, path, referrer, userAgent } = parsed.data;
  const now = new Date();

  await prisma.siteVisitor.upsert({
    where: { visitorId },
    create: {
      visitorId,
      firstSeenAt: now,
      lastSeenAt: now,
      lastPath: path ?? null,
      referrer: referrer ?? null,
      userAgent: userAgent ?? null,
    },
    update: {
      lastSeenAt: now,
      lastPath: path ?? null,
      referrer: referrer ?? null,
      userAgent: userAgent ?? null,
    },
  });

  return NextResponse.json({ status: "ok" });
}
