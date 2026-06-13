import type { Candidate } from "@/lib/types";

function cleanFullName(name: string): string {
  return name.trim().replace(/^https:\/\/github\.com\//i, "").toLowerCase();
}

function repoSegment(name: string): string | null {
  const cleaned = cleanFullName(name);
  if (!cleaned.includes("/")) return null;
  return cleaned.split("/")[1] ?? null;
}

export function normalizeCanonicalNames(
  requestedNames: string[],
  candidates: Candidate[],
  resolvedNames: string[] = [],
): string[] {
  const candidateByFullName = new Map(
    candidates.map((candidate) => [candidate.fullName.toLowerCase(), candidate.fullName]),
  );
  const candidatesByRepoName = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase();
    const bucket = candidatesByRepoName.get(key) ?? [];
    bucket.push(candidate);
    candidatesByRepoName.set(key, bucket);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined) => {
    if (!name) return;
    const cleaned = cleanFullName(name);
    if (!cleaned.includes("/") || seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push(cleaned);
  };

  for (const name of resolvedNames) add(name);

  for (const rawName of requestedNames) {
    const cleaned = cleanFullName(rawName);
    if (!cleaned.includes("/")) continue;

    const exact = candidateByFullName.get(cleaned);
    if (exact) {
      add(exact);
      continue;
    }

    const repo = repoSegment(cleaned);
    if (!repo) continue;
    const sameRepo = candidatesByRepoName.get(repo) ?? [];
    if (sameRepo.length === 1) {
      add(sameRepo[0].fullName);
      continue;
    }

    add(cleaned);
  }

  return out;
}
