import { NextResponse } from "next/server";
import { octokit } from "@/lib/github/client";
import { getStarHistory } from "@/lib/github/starHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await ctx.params;
  const fullName = `${owner}/${name}`;

  // The caller (a result card) already knows the star count — pass it as ?stars=
  // to avoid an extra repo lookup. Fall back to a lightweight fetch otherwise.
  const url = new URL(req.url);
  let stars = Number(url.searchParams.get("stars"));

  try {
    if (!Number.isFinite(stars) || stars <= 0) {
      const repo = await octokit.rest.repos.get({ owner, repo: name });
      stars = repo.data.stargazers_count ?? 0;
    }
    const history = await getStarHistory(owner, name, stars);
    return NextResponse.json({ fullName, history });
  } catch {
    // Non-fatal: the UI hides the sparkline when history is empty.
    return NextResponse.json({ fullName, history: [] });
  }
}
