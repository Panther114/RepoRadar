import { z } from "zod";
import { clamp01, computeTotal } from "@/lib/scoring/rubric";
import type { Analysis, Intent, ListwiseRankedResult, RepoEvidence, RepoTypeClassification } from "@/lib/types";

const SYSTEM = `You are RepoRadar's listwise repository ranker. Rank all candidate repositories RELATIVE TO EACH OTHER for the user's intent.

Prefer the repositories that best satisfy the plain-language need, even when the prompt is short or vague. Use evidence only. A famous repo gets no automatic win unless the evidence fits the user need. A rescued or guidance-suggested repo gets no shortcut.

Classify repository type flexibly. Use one or more labels from:
library, framework, cli, app, template, demo, tutorial, awesome-list, plugin, extension, dataset, docs/profile, generated-sdk, mirror/fork-like, research, unknown.

Return ONLY JSON:
{
  "results": [
    {
      "fullName": string,
      "rank": number,
      "fit": number,
      "repoTypes": [{"type": string, "confidence": number, "evidence": string}],
      "summary": string,
      "matchedFeatures": [{"feature": string, "evidence": string, "confidence": number}],
      "missingFeatures": [{"feature": string, "reason": string, "confidence": number}],
      "risks": [{"risk": string, "evidence": string, "severity": "low"|"medium"|"high"}]
    }
  ]
}`;

const schema = z.object({
  results: z.array(z.object({
    fullName: z.string(),
    rank: z.number(),
    fit: z.number().transform(clamp01),
    repoTypes: z.array(z.object({
      type: z.string(),
      confidence: z.number().transform(clamp01),
      evidence: z.string().optional(),
    })).optional(),
    summary: z.string().optional(),
    matchedFeatures: z.array(z.object({ feature: z.string(), evidence: z.string(), confidence: z.number() })).optional(),
    missingFeatures: z.array(z.object({ feature: z.string(), reason: z.string(), confidence: z.number() })).optional(),
    risks: z.array(z.object({ risk: z.string(), evidence: z.string(), severity: z.enum(["low", "medium", "high"]) })).optional(),
  })),
});

const REPO_TYPE_LABELS = new Set([
  "library",
  "framework",
  "cli",
  "app",
  "template",
  "demo",
  "tutorial",
  "awesome-list",
  "plugin",
  "extension",
  "dataset",
  "docs/profile",
  "generated-sdk",
  "mirror/fork-like",
  "research",
  "unknown",
]);

function normalizeRepoType(type: string): string {
  const value = type.trim().toLowerCase().replaceAll("_", "-");
  if (REPO_TYPE_LABELS.has(value)) return value;
  if (value.includes("awesome")) return "awesome-list";
  if (value.includes("sdk")) return "generated-sdk";
  if (value.includes("fork") || value.includes("mirror")) return "mirror/fork-like";
  if (value.includes("doc")) return "docs/profile";
  if (value.includes("command") || value.includes("terminal")) return "cli";
  if (value.includes("plugin")) return "plugin";
  if (value.includes("extension")) return "extension";
  if (value.includes("template") || value.includes("starter")) return "template";
  if (value.includes("tutorial") || value.includes("example")) return "tutorial";
  if (value.includes("paper") || value.includes("research")) return "research";
  if (value.includes("framework") || value.includes("suite")) return "framework";
  if (value.includes("tool") || value.includes("application")) return "app";
  if (value.includes("library") || value.includes("package")) return "library";
  return "unknown";
}

function payload(evidence: RepoEvidence, baseline: Analysis) {
  return {
    fullName: evidence.candidate.fullName,
    description: evidence.candidate.description,
    language: evidence.candidate.primaryLanguage,
    topics: evidence.candidate.topics,
    stars: evidence.candidate.stars,
    forks: evidence.candidate.forks,
    pushedAt: evidence.candidate.pushedAt,
    license: evidence.candidate.licenseSpdx,
    similarity: Number(evidence.similarity.toFixed(3)),
    baselineFit: Number(baseline.fit.toFixed(3)),
    baselineFuture: Number(baseline.future.toFixed(3)),
    manifests: evidence.manifests.map((m) => m.file),
    docs: evidence.docsSignals,
    readmeExcerpt: (evidence.readme ?? "").slice(0, 900),
  };
}

export async function rankReposListwise(
  intent: Intent,
  evidences: RepoEvidence[],
  baselines: Analysis[],
): Promise<ListwiseRankedResult[] | null> {
  const { chatJson } = await import("@/lib/llm/json");
  const timeoutMs = Number(process.env.LISTWISE_TIMEOUT_MS) || 10_000;
  const raw = await Promise.race([
    chatJson<unknown>({
      system: SYSTEM,
      user: JSON.stringify({
        intent: { prompt: intent.normalizedPrompt, constraints: intent.constraints },
        candidates: evidences.map((e, i) => payload(e, baselines[i])),
      }),
      temperature: 0,
      maxTokens: 1800,
      timeoutMs,
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!raw) return null;
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data.results.length === 0) return null;

  return parsed.data.results
    .map((r) => ({
      fullName: r.fullName,
      rank: r.rank,
      fit: r.fit,
      repoTypes: (r.repoTypes ?? [{ type: "unknown", confidence: 0.5 }]).map((repoType) => ({
        ...repoType,
        type: normalizeRepoType(repoType.type),
      })) as RepoTypeClassification[],
      summary: r.summary ?? "",
      matchedFeatures: r.matchedFeatures ?? [],
      missingFeatures: r.missingFeatures ?? [],
      risks: r.risks ?? [],
    }))
    .sort((a, b) => a.rank - b.rank);
}

export function applyListwiseRanking(args: {
  evidences: RepoEvidence[];
  baselines: Analysis[];
  listwise: ListwiseRankedResult[];
}): { evidence: RepoEvidence; analysis: Analysis }[] {
  const byName = new Map(args.listwise.map((result) => [result.fullName.toLowerCase(), result]));

  return args.evidences
    .map((evidence, index) => {
      const baseline = args.baselines[index];
      const ranked = byName.get(evidence.candidate.fullName.toLowerCase());
      if (!ranked) return { evidence, analysis: baseline, rank: 10_000 + index };

      const repoType = ranked.repoTypes.sort((a, b) => b.confidence - a.confidence)[0]?.type ?? baseline.repoType;
      const fit = ranked.fit;
      const analysis: Analysis = {
        ...baseline,
        repoType,
        fit,
        total: computeTotal(fit, baseline.future, baseline.underrated),
        matchedFeatures: ranked.matchedFeatures,
        missingFeatures: ranked.missingFeatures,
        risks: ranked.risks.length ? ranked.risks : baseline.risks,
        summary: ranked.summary || baseline.summary,
        source: "ai",
      };
      return { evidence, analysis, rank: ranked.rank };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ evidence, analysis }) => ({ evidence, analysis }));
}
