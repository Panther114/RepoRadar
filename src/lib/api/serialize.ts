// Reshape a persisted SearchResult row into the API/UI result shape (spec §10).
// Everything the UI needs was stored in `scoreBreakdown` at write time.

interface ResultRow {
  rank: number | null;
  fitScore: number | null;
  futureScore: number | null;
  underratedScore: number | null;
  totalScore: number | null;
  scoreBreakdown: unknown;
  repo?: {
    fullName: string;
    htmlUrl: string;
    description: string | null;
    primaryLanguage: string | null;
    licenseSpdx: string | null;
  } | null;
}

export interface ApiResult {
  rank: number | null;
  repo: Record<string, unknown>;
  scores: { fit: number | null; future: number | null; underrated: number | null; total: number | null };
  analysis: unknown;
  metrics: unknown;
  docs: unknown;
  similarity: unknown;
}

export function serializeResult(row: ResultRow): ApiResult {
  const b = (row.scoreBreakdown ?? {}) as Record<string, unknown>;
  return {
    rank: row.rank,
    repo:
      (b.repo as Record<string, unknown>) ??
      (row.repo
        ? {
            fullName: row.repo.fullName,
            url: row.repo.htmlUrl,
            description: row.repo.description,
            language: row.repo.primaryLanguage,
            license: row.repo.licenseSpdx,
          }
        : {}),
    scores: {
      fit: row.fitScore,
      future: row.futureScore,
      underrated: row.underratedScore,
      total: row.totalScore,
    },
    analysis: b.analysis ?? null,
    metrics: b.metrics ?? null,
    docs: b.docs ?? null,
    similarity: b.similarity ?? null,
  };
}
