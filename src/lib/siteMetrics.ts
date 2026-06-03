import { prisma } from "@/lib/db";

export type HeaderMetrics = {
  userCount: number | null;
  requestCount: number | null;
};

export async function getHeaderMetrics(): Promise<HeaderMetrics> {
  try {
    const [userCount, requestCount] = await prisma.$transaction([
      prisma.siteVisitor.count(),
      prisma.searchQuery.count(),
    ]);

    return { userCount, requestCount };
  } catch {
    return { userCount: null, requestCount: null };
  }
}
