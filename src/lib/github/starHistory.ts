import { octokit } from "@/lib/github/client";

export interface StarPoint {
  date: string; // ISO timestamp
  stars: number; // cumulative star count at that date
}

interface CacheEntry {
  at: number;
  data: StarPoint[];
}

// Star history barely changes within a day, and the sampling costs ~10 GitHub
// calls, so cache aggressively in-memory. (No DB table needed — a restart just
// rebuilds lazily.)
const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 3_600_000; // 6h

const MAX_SAMPLES = 10;
// GitHub only serves the first ~40,000 results of any list, so stargazer
// sampling can't see past that index. We still append the live total as the
// final point, so the curve's tail (recent growth) stays correct.
const PAGE_CAP = 40_000;

/**
 * Build a real star-count-over-time curve by sampling the stargazers timeline.
 *
 * Technique (the same one star-history.com uses, minimised): the GitHub
 * stargazers endpoint with `Accept: application/vnd.github.star+json` returns a
 * `starred_at` per stargazer. Requesting `per_page=1&page=N` yields the Nth
 * stargazer — i.e. the date at which the repo reached N stars. We sample ~10
 * evenly-spaced N values to get a cumulative curve with tiny payloads (~10
 * one-item requests), then cache the result.
 */
export async function getStarHistory(
  owner: string,
  name: string,
  totalStars: number,
): Promise<StarPoint[]> {
  const key = `${owner}/${name}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  // Too few stars to draw a meaningful curve.
  if (!totalStars || totalStars < 8) {
    const data: StarPoint[] =
      totalStars > 0 ? [{ date: new Date().toISOString(), stars: totalStars }] : [];
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  const reachable = Math.min(totalStars, PAGE_CAP);
  const samples = Math.min(MAX_SAMPLES, reachable);

  // Evenly-spaced cumulative indices across the reachable range.
  const targets = Array.from(
    new Set(
      Array.from({ length: samples }, (_, i) =>
        Math.max(1, Math.round((reachable * (i + 1)) / samples)),
      ),
    ),
  );

  const points: StarPoint[] = [];
  await Promise.all(
    targets.map(async (count) => {
      try {
        const res = await octokit.request("GET /repos/{owner}/{repo}/stargazers", {
          owner,
          repo: name,
          per_page: 1,
          page: count,
          headers: { accept: "application/vnd.github.star+json" },
        });
        const item = (res.data as unknown as { starred_at?: string }[])[0];
        if (item?.starred_at) points.push({ date: item.starred_at, stars: count });
      } catch {
        /* a single failed sample is non-fatal — the curve degrades gracefully */
      }
    }),
  );

  // Always anchor the curve with the live total at "now".
  points.push({ date: new Date().toISOString(), stars: totalStars });

  points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  // Sampling can jitter; enforce a monotonically non-decreasing cumulative count.
  for (let i = 1; i < points.length; i++) {
    if (points[i].stars < points[i - 1].stars) points[i].stars = points[i - 1].stars;
  }

  const data = points.length >= 2 ? points : [];
  cache.set(key, { at: Date.now(), data });
  return data;
}
