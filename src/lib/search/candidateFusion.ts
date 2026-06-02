import type { Candidate, CandidateSource } from "@/lib/types";

interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  firstSeen: number;
}

export function fuseCandidateSources(sources: CandidateSource[], maxPool: number): Candidate[] {
  const byId = new Map<number, ScoredCandidate>();
  let seq = 0;

  for (const source of sources) {
    source.candidates.forEach((candidate, index) => {
      const existing = byId.get(candidate.githubId);
      const rrf = 1 / (60 + index + 1);
      if (existing) {
        existing.score += rrf;
        if (candidate.stars > existing.candidate.stars) existing.candidate = candidate;
      } else {
        byId.set(candidate.githubId, { candidate, score: rrf, firstSeen: seq++ });
      }
    });
  }

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score || b.candidate.stars - a.candidate.stars || a.firstSeen - b.firstSeen)
    .map((entry) => entry.candidate)
    .slice(0, maxPool);
}
