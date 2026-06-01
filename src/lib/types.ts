// Shared domain types for the RepoRadar pipeline.

export type ProjectType =
  | "library"
  | "framework"
  | "cli"
  | "app"
  | "template"
  | "demo"
  | "research"
  | "tutorial"
  | "awesome-list"
  | "plugin"
  | "extension"
  | "dataset"
  | "any";

/** Structured constraints extracted from the user's natural-language prompt. */
export interface Constraints {
  keywords: string[];
  requiredFeatures: string[];
  /**
   * Orthogonal facets of the query that a repo must ALL satisfy to be relevant
   * (e.g. ["frontend UI design", "skill for Claude Code / Codex"]). Used by the
   * funnel for conjunctive (aspect-decomposed) semantic ranking so that a strong
   * match on one axis can't drown out a total miss on another. Empty = single-
   * vector ranking (heuristic fallback).
   */
  aspects: string[];
  language: string | null;
  licenses: string[];
  pushedWithinDays: number | null;
  projectType: ProjectType;
  includeSmallProjects: boolean;
  minStars: number | null;
  maxStars: number | null;
}

/** Optional UI-supplied filters (mirror of POST /api/search `filters`). */
export interface SearchFilters {
  language?: string | null;
  license?: string[];
  includeSmallProjects?: boolean;
  minFutureScore?: number | null;
  projectType?: ProjectType;
  pushedWithinDays?: number | null;
  minStars?: number | null;
}

export interface Intent {
  normalizedPrompt: string;
  constraints: Constraints;
  /** GitHub-compatible search query strings (multiple variants). */
  queries: string[];
}

/** A repository candidate as returned by GitHub search. */
export interface Candidate {
  githubId: number;
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  description: string | null;
  primaryLanguage: string | null;
  licenseSpdx: string | null;
  topics: string[];
  isArchived: boolean;
  isFork: boolean;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
}

export interface ManifestInfo {
  file: string; // e.g. package.json
  ecosystem: string; // npm | pypi | cargo | go | maven | gradle | other
  packageName?: string | null;
  dependencyCount?: number | null;
  hasDeps: boolean;
}

/** Everything we fetch about a survivor before scoring it. */
export interface RepoEvidence {
  candidate: Candidate;
  readme: string | null; // truncated/structured
  readmeHash: string | null;
  manifests: ManifestInfo[];
  releaseCount: number;
  latestReleaseAt: string | null;
  releasesLast90: number;
  releasesLast365: number;
  hasChangelog: boolean;
  openIssues: number;
  closedIssues: number;
  openPRs: number;
  mergedPRs: number;
  contributorCount: number;
  isOrgOwned: boolean;
  docsSignals: {
    hasInstall: boolean;
    hasQuickstart: boolean;
    hasExamples: boolean;
    hasApiDocs: boolean;
    hasDocsFolder: boolean;
    hasWebsite: boolean;
    readmeLength: number;
  };
  /** Cosine similarity of intent vs repo evidence (0..1), from the funnel. */
  similarity: number;
}

export interface MatchedFeature {
  feature: string;
  evidence: string;
  confidence: number;
}
export interface MissingFeature {
  feature: string;
  reason: string;
  confidence: number;
}
export interface Risk {
  risk: string;
  evidence: string;
  severity: "low" | "medium" | "high";
}

export type ComponentScores = Record<string, number>;

/** The scored + explained result. Scores are AI-produced (or deterministic fallback). */
export interface Analysis {
  repoType: string;
  fit: number;
  future: number;
  underrated: number;
  total: number;
  fitComponents: ComponentScores;
  futureComponents: ComponentScores;
  matchedFeatures: MatchedFeature[];
  missingFeatures: MissingFeature[];
  risks: Risk[];
  summary: string;
  /** Whether scores came from the LLM or the deterministic fallback. */
  source: "ai" | "deterministic";
}

/** A fully scored result, ready to persist + return to the UI. */
export interface ScoredResult {
  candidate: Candidate;
  evidence: RepoEvidence;
  analysis: Analysis;
}

export type JobStatus = "queued" | "running" | "completed" | "failed";
