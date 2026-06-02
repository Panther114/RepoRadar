import { z } from "zod";
import { chatJson } from "@/lib/llm/json";
import { clamp01, computeTotal, FIT_WEIGHTS, FUTURE_WEIGHTS } from "@/lib/scoring/rubric";
import { deterministicScore } from "@/lib/scoring/deterministic";
import type { Analysis, Intent, RepoEvidence } from "@/lib/types";

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 86400_000) : null;
}

/** Compact, token-bounded evidence payload for the model. */
function evidencePayload(e: RepoEvidence) {
  return {
    fullName: e.candidate.fullName,
    description: e.candidate.description,
    language: e.candidate.primaryLanguage,
    license: e.candidate.licenseSpdx,
    topics: e.candidate.topics,
    stars: e.candidate.stars,
    forks: e.candidate.forks,
    daysSinceLastPush: daysSince(e.candidate.pushedAt),
    isArchived: e.candidate.isArchived,
    embeddingSimilarity: Number(e.similarity.toFixed(3)),
    manifests: e.manifests.map((m) => ({ file: m.file, ecosystem: m.ecosystem, deps: m.dependencyCount })),
    releases: { total: e.releaseCount, last90: e.releasesLast90, last365: e.releasesLast365, latest: e.latestReleaseAt, changelog: e.hasChangelog },
    issuesPrs: { openIssues: e.openIssues, closedIssues: e.closedIssues, openPRs: e.openPRs, mergedPRs: e.mergedPRs },
    contributors: e.contributorCount,
    orgOwned: e.isOrgOwned,
    docs: e.docsSignals,
    readmeExcerpt: (e.readme ?? "").slice(0, 3500),
  };
}

const SYSTEM = `You are RepoRadar's repository evaluator. Given a user's intent and EVIDENCE about ONE GitHub repository, you PRODUCE the scores. Ground every judgement in the provided evidence — never invent facts.

Use these rubrics (weights are guidance for how to weigh sub-scores; you still output the final 0..1 scores):
Fit = 0.55 semantic_similarity + 0.20 explicit_feature_match + 0.10 language_framework_match + 0.07 package_manifest_match + 0.05 constraint_satisfaction + 0.03 repository_type_match
Future = 0.20 recent_activity + 0.15 release_cadence + 0.15 issue_pr_health + 0.15 contributor_health + 0.15 star_velocity + 0.10 documentation_quality + 0.10 ecosystem_signal (minus risk penalties)
Underrated: high fit + high future + good docs + recent growth, MINUS popularity saturation (a great small repo scores high; a hugely popular but only-loosely-relevant repo scores low).

Return ONLY this JSON (all scores in [0,1]):
{
  "repoType": string,
  "fit": number, "future": number, "underrated": number,
  "fitComponents": { "semantic_similarity":n,"explicit_feature_match":n,"language_framework_match":n,"package_manifest_match":n,"constraint_satisfaction":n,"repository_type_match":n },
  "futureComponents": { "recent_activity":n,"release_cadence":n,"issue_pr_health":n,"contributor_health":n,"star_velocity":n,"documentation_quality":n,"ecosystem_signal":n },
  "matchedFeatures": [{"feature":string,"evidence":string,"confidence":number}],
  "missingFeatures": [{"feature":string,"reason":string,"confidence":number}],
  "risks": [{"risk":string,"evidence":string,"severity":"low"|"medium"|"high"}],
  "summary": string
}`;

const num = z.number().transform((n) => clamp01(n));
const aiSchema = z.object({
  repoType: z.string().optional(),
  fit: num,
  future: num,
  underrated: num,
  fitComponents: z.record(z.string(), z.number()).optional(),
  futureComponents: z.record(z.string(), z.number()).optional(),
  matchedFeatures: z.array(z.object({ feature: z.string(), evidence: z.string(), confidence: z.number() })).optional(),
  missingFeatures: z.array(z.object({ feature: z.string(), reason: z.string(), confidence: z.number() })).optional(),
  risks: z.array(z.object({ risk: z.string(), evidence: z.string(), severity: z.enum(["low", "medium", "high"]) })).optional(),
  summary: z.string().optional(),
});

function clampComponents(obj: Record<string, number> | undefined, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = clamp01(obj?.[k] ?? 0);
  return out;
}

/**
 * Score one repository. The LLM produces the scores; on disabled/failed LLM we
 * fall back to the deterministic scorer (same Analysis shape).
 */
export async function scoreRepo(intent: Intent, evidence: RepoEvidence): Promise<Analysis> {
  const raw = await chatJson<unknown>({
    system: SYSTEM,
    user: `USER INTENT:\n${JSON.stringify({ prompt: intent.normalizedPrompt, constraints: intent.constraints })}\n\nREPOSITORY EVIDENCE:\n${JSON.stringify(evidencePayload(evidence))}`,
    temperature: 0.2,
    // 1000 is enough for the scores + a few matched/missing features + a short
    // summary; trimmed from 1300 to cut generation time on the slowest calls
    // (output tokens dominate latency for the scoring step).
    maxTokens: 1000,
  });

  if (!raw) return deterministicScore(intent, evidence);

  const parsed = aiSchema.safeParse(raw);
  if (!parsed.success) return deterministicScore(intent, evidence);
  const d = parsed.data;

  const fit = d.fit;
  const future = d.future;
  const underrated = d.underrated;

  return {
    repoType: d.repoType ?? "unknown",
    fit,
    future,
    underrated,
    total: computeTotal(fit, future, underrated),
    fitComponents: clampComponents(d.fitComponents, Object.keys(FIT_WEIGHTS)),
    futureComponents: clampComponents(d.futureComponents, Object.keys(FUTURE_WEIGHTS)),
    matchedFeatures: d.matchedFeatures ?? [],
    missingFeatures: d.missingFeatures ?? [],
    risks: d.risks ?? [],
    summary: d.summary ?? "",
    source: "ai",
  };
}
