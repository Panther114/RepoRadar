// Client-safe view types for API responses.

export interface UiScores {
  fit: number | null;
  future: number | null;
  underrated: number | null;
  total: number | null;
}

export interface UiMatched {
  feature: string;
  evidence: string;
  confidence: number;
}
export interface UiMissing {
  feature: string;
  reason: string;
  confidence: number;
}
export interface UiRisk {
  risk: string;
  evidence: string;
  severity: "low" | "medium" | "high" | string;
}

export interface UiAnalysis {
  repoType: string;
  summary: string;
  source: "ai" | "deterministic" | string;
  fitComponents: Record<string, number>;
  futureComponents: Record<string, number>;
  matchedFeatures: UiMatched[];
  missingFeatures: UiMissing[];
  risks: UiRisk[];
}

export interface UiRepo {
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  license: string | null;
  topics?: string[];
}

export interface UiMetrics {
  stars: number;
  forks: number;
  openIssues: number;
  closedIssues?: number;
  openPRs?: number;
  mergedPRs?: number;
  contributors?: number;
  pushedAt: string | null;
  createdAt: string | null;
  releaseCount?: number;
  releasesLast90?: number;
  releasesLast365?: number;
  latestReleaseAt?: string | null;
}

export interface UiDocs {
  hasInstall?: boolean;
  hasQuickstart?: boolean;
  hasExamples?: boolean;
  hasApiDocs?: boolean;
  hasDocsFolder?: boolean;
  hasWebsite?: boolean;
  readmeLength?: number;
}

export interface UiResult {
  rank: number | null;
  repo: UiRepo;
  scores: UiScores;
  analysis: UiAnalysis | null;
  metrics: UiMetrics | null;
  docs?: Record<string, unknown> | null;
  similarity?: number | null;
}

export interface SearchResponse {
  searchId: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  stage?: string | null;
  progress?: number;
  error?: string | null;
  prompt?: string | null;
  constraints?: Record<string, unknown> | null;
  results: UiResult[];
}

export interface SearchFiltersInput {
  language?: string | null;
  license?: string[];
  includeSmallProjects?: boolean;
  minFutureScore?: number | null;
  projectType?: string;
  pushedWithinDays?: number | null;
  minStars?: number | null;
}

export interface TrendsResponse {
  fullName: string;
  starTrend: { date: string; stars: number; forks: number; openIssues: number }[];
  radar: { axis: string; value: number }[];
  fitRadar: { axis: string; value: number }[];
  releases: { total: number; last90: number; last365: number; latest: string | null };
}
