import type { Candidate } from "@/lib/types";

// Injection gate for out-of-band candidate sources (awesome lists, package
// registries). GitHub-search candidates earned their pool slot by matching the
// query; injected ones did not — awesome lists link plenty of abandoned or
// loosely-related projects, and registry hits can be tiny wrappers. The first
// v1.1.4 eval showed ungated injection polluting the final ranking (junk
// 0.17 → 0.75) and evicting gold repos from the pool. Every injected candidate
// must therefore clear all three bars:
//   1. topicality — ≥2 distinct query tokens (or one full keyword phrase) in
//      its name/description/topics (same threshold that fixed guidance
//      over-matching in v1.1.2),
//   2. traction — ≥50 stars, unless the user asked for small/underrated repos,
//   3. liveness — pushed within the last 2 years (awesome lists accumulate
//      dead projects for years after they stop being good answers).

const MIN_STARS = 50;
const MIN_TOKEN_MATCHES = 2;
const MAX_STALE_DAYS = 730;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 2);
}

export function passesInjectionGate(
  candidate: Candidate,
  keywords: string[],
  includeSmallProjects: boolean,
  now: number = Date.now(),
): boolean {
  if (!includeSmallProjects && candidate.stars < MIN_STARS) return false;

  const pushed = candidate.pushedAt ? new Date(candidate.pushedAt).getTime() : NaN;
  if (!Number.isFinite(pushed) || (now - pushed) / 86400_000 > MAX_STALE_DAYS) return false;

  const haystack = [
    candidate.fullName,
    candidate.description ?? "",
    candidate.topics.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  // A full multi-word keyword phrase appearing verbatim is strong evidence.
  for (const kw of keywords) {
    const phrase = kw.toLowerCase().trim();
    if (phrase.includes(" ") && haystack.includes(phrase)) return true;
  }

  const queryTokens = new Set(keywords.flatMap(tokenize));
  const candTokens = new Set(tokenize(haystack));
  let matches = 0;
  for (const t of queryTokens) {
    if (candTokens.has(t)) matches++;
    if (matches >= MIN_TOKEN_MATCHES) return true;
  }
  return false;
}
