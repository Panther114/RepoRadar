import { z } from "zod";
import { clamp01, computeTotal } from "@/lib/scoring/rubric";
import type { Analysis, Intent, ListwiseRankedResult, RepoEvidence, RepoTypeClassification } from "@/lib/types";

const SYSTEM = `You are RepoRadar's listwise repository ranker. Rank ALL candidate repositories RELATIVE TO EACH OTHER for the user's intent, then return EVERY candidate exactly once.

Prefer the repositories that best satisfy the plain-language need, even when the prompt is short or vague. Use evidence only. A famous repo gets no automatic win unless the evidence fits the user need. A rescued or guidance-suggested repo gets no shortcut.

CRITICAL RELEVANCE RULE: set "relevant": false for any candidate that does NOT genuinely match the user's need — e.g. an off-topic library that merely shares a keyword (a state-manager for a "data table" query), a personal tutorial / course / boilerplate / homework repo, an empty or abandoned demo, or a name-only keyword match with no real capability. Irrelevant repos are always ranked AFTER every relevant one regardless of stars. Be strict: it is better to mark a weak repo irrelevant than to pollute the shortlist.

Classify each repository with ONE primary type label from:
library, framework, cli, app, template, demo, tutorial, awesome-list, plugin, extension, dataset, docs/profile, generated-sdk, mirror/fork-like, research, unknown.

Keep output COMPACT so all candidates fit. Return ONLY JSON:
{
  "results": [
    {
      "fullName": string,        // must exactly match a candidate fullName
      "rank": number,            // 1 = best; rank every candidate
      "fit": number,             // 0..1 how well it matches the need
      "relevant": boolean,       // false = off-topic / low-quality, demote below all relevant repos
      "repoType": string,        // one label from the list above
      "summary": string          // <= 140 chars, why it ranked here
    }
  ]
}`;

const schema = z.object({
  results: z.array(z.object({
    fullName: z.string(),
    rank: z.number(),
    fit: z.number().transform(clamp01),
    relevant: z.boolean().optional(),
    repoType: z.string().optional(),
    repoTypes: z.array(z.object({
      type: z.string(),
      confidence: z.number().transform(clamp01),
      evidence: z.string().optional(),
    })).optional(),
    summary: z.string().optional(),
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
  const timeoutMs = Number(process.env.LISTWISE_TIMEOUT_MS) || 12_000;
  const user = JSON.stringify({
    intent: { prompt: intent.normalizedPrompt, constraints: intent.constraints },
    candidates: evidences.map((e, i) => payload(e, baselines[i])),
  });

  // The slimmed schema (~40 tokens/repo) fits comfortably; 3000 leaves ample
  // headroom for 15 candidates so the JSON is never truncated mid-array — the
  // truncation that used to make this call silently return null and collapse
  // ranking to the noisy deterministic fallback.
  const call = (maxTokens: number) =>
    Promise.race([
      chatJson<unknown>({ system: SYSTEM, user, temperature: 0, maxTokens, timeoutMs }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

  let raw = await call(3000);
  let parsed = raw ? schema.safeParse(raw) : null;
  // One retry on a hard parse miss — a transient malformed response shouldn't
  // drop us all the way to deterministic ranking.
  if (!parsed?.success || parsed.data.results.length === 0) {
    raw = await call(3500);
    parsed = raw ? schema.safeParse(raw) : null;
  }
  if (!parsed?.success || parsed.data.results.length === 0) return null;

  return parsed.data.results
    .map((r) => {
      const types = r.repoTypes?.length
        ? r.repoTypes
        : [{ type: r.repoType ?? "unknown", confidence: 0.6 }];
      return {
        fullName: r.fullName,
        rank: r.rank,
        fit: r.fit,
        relevant: r.relevant ?? true,
        repoTypes: types.map((repoType) => ({
          ...repoType,
          type: normalizeRepoType(repoType.type),
        })) as RepoTypeClassification[],
        summary: r.summary ?? "",
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

export function applyListwiseRanking(args: {
  evidences: RepoEvidence[];
  baselines: Analysis[];
  listwise: ListwiseRankedResult[];
}): { evidence: RepoEvidence; analysis: Analysis }[] {
  const byName = new Map(args.listwise.map((result) => [result.fullName.toLowerCase(), result]));

  // Quality-aware fallback for candidates the model omitted from its response.
  // They slot between the relevant and the irrelevant tiers, ordered by a blend
  // of fit, similarity, and health so we never dump strong repos at the bottom.
  const qualityKey = (baseline: Analysis, e: RepoEvidence): number =>
    baseline.fit * 0.5 + e.similarity * 0.3 + baseline.future * 0.2;

  return args.evidences
    .map((evidence, index) => {
      const baseline = args.baselines[index];
      const ranked = byName.get(evidence.candidate.fullName.toLowerCase());
      if (!ranked) {
        // Omitted by the model → middle tier, ordered by quality (desc).
        return { evidence, analysis: baseline, tier: 1, order: -qualityKey(baseline, evidence) };
      }

      const repoType = ranked.repoTypes.sort((a, b) => b.confidence - a.confidence)[0]?.type ?? baseline.repoType;
      // An irrelevant verdict caps fit so the displayed score reflects the demotion.
      const fit = ranked.relevant ? ranked.fit : Math.min(ranked.fit, 0.4);
      const analysis: Analysis = {
        ...baseline,
        repoType,
        fit,
        total: computeTotal(fit, baseline.future, baseline.underrated),
        summary: ranked.summary || baseline.summary,
        source: "ai",
      };
      // Tier 0 = relevant (top), tier 2 = explicitly irrelevant (bottom).
      return { evidence, analysis, tier: ranked.relevant ? 0 : 2, order: ranked.rank };
    })
    .sort((a, b) => a.tier - b.tier || a.order - b.order)
    .map(({ evidence, analysis }) => ({ evidence, analysis }));
}
