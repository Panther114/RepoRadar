import {
  FIT_WEIGHTS,
  FUTURE_WEIGHTS,
  clamp01,
  computeTotal,
  weighted,
} from "@/lib/scoring/rubric";
import type {
  Analysis,
  Intent,
  MatchedFeature,
  MissingFeature,
  RepoEvidence,
  Risk,
} from "@/lib/types";

function evidenceText(e: RepoEvidence): string {
  return [
    e.candidate.fullName,
    e.candidate.description ?? "",
    e.candidate.topics.join(" "),
    e.readme ?? "",
  ]
    .join(" \n ")
    .toLowerCase();
}

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 86400_000 : Infinity;
}

// JavaScript and TypeScript are interchangeable for discovery purposes: GitHub
// classifies a repo by its dominant language, so a TS-majority project (redux,
// zustand) and a JS-majority one solve the same need. Treating them as a match
// stops the language component from punishing the canonical answer to a JS/TS
// query just because GitHub happened to label it the other one.
const JS_TS = new Set(["javascript", "typescript"]);
function languageMatches(repoLang: string | null, want: string): boolean {
  const a = (repoLang ?? "").toLowerCase();
  const b = want.toLowerCase();
  if (a === b) return true;
  return JS_TS.has(a) && JS_TS.has(b);
}

function recency(iso: string | null): number {
  const d = daysSince(iso);
  if (d < 30) return 1;
  if (d < 90) return 0.85;
  if (d < 180) return 0.65;
  if (d < 365) return 0.4;
  return 0.15;
}

function docsQuality(e: RepoEvidence): number {
  const s = e.docsSignals;
  const flags = [
    s.hasInstall, s.hasQuickstart, s.hasExamples, s.hasApiDocs,
    s.hasDocsFolder, s.hasWebsite, s.readmeLength > 800,
  ];
  return clamp01(flags.filter(Boolean).length / flags.length);
}

/**
 * Fully deterministic scoring used when the LLM is disabled or unavailable.
 * Produces the same Analysis shape the AI scorer returns (source: "deterministic").
 */
export function deterministicScore(intent: Intent, e: RepoEvidence): Analysis {
  const c = intent.constraints;
  const text = evidenceText(e);

  // --- Fit components ---
  const features = c.requiredFeatures.length ? c.requiredFeatures : c.keywords;

  // Tiered matching: matches in name/description are strong evidence of
  // relevance; topic matches are medium; README-only matches are weak
  // (coincidental appearances are common in long READMEs).
  const nameDesc = [e.candidate.fullName, e.candidate.description ?? ""]
    .join(" ")
    .toLowerCase();
  const topicsText = e.candidate.topics.join(" ").toLowerCase();

  const matchedFeatures: MatchedFeature[] = [];
  const missingFeatures: MissingFeature[] = [];
  let featureScoreSum = 0;

  for (const f of features) {
    const toks = f
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    if (toks.length === 0) continue;

    const inNameDesc = toks.every((tok) => nameDesc.includes(tok));
    const inTopics = toks.some((tok) => topicsText.includes(tok));
    const inReadme = toks.every((tok) => text.includes(tok));

    if (inNameDesc) {
      matchedFeatures.push({
        feature: f,
        evidence: "Found in repository name or description.",
        confidence: 0.9,
      });
      featureScoreSum += 1.0;
    } else if (inTopics) {
      matchedFeatures.push({
        feature: f,
        evidence: "Found in repository topics.",
        confidence: 0.75,
      });
      featureScoreSum += 0.7;
    } else if (inReadme) {
      matchedFeatures.push({
        feature: f,
        evidence: "Mentioned in README.",
        confidence: 0.45,
      });
      featureScoreSum += 0.35;
    } else {
      missingFeatures.push({
        feature: f,
        reason: "No explicit mention found in fetched evidence.",
        confidence: 0.6,
      });
    }
  }

  const featureMatch = features.length > 0
    ? featureScoreSum / features.length
    : e.similarity;

  const langMatch = !c.language
    ? 0.8
    : languageMatches(e.candidate.primaryLanguage, c.language)
      ? 1
      : 0.3;

  // Manifest penalty only applies when we're explicitly looking for a packaged
  // library/framework. Skills catalogs, awesome lists, and doc collections
  // legitimately have no package.json — don't penalise them.
  const noManifestScore =
    c.projectType === "library" || c.projectType === "framework" ? 0.3 : 0.60;
  const manifestMatch = e.manifests.length
    ? e.manifests.some((m) => m.hasDeps)
      ? 1
      : 0.7
    : noManifestScore;

  const licenseOk =
    c.licenses.length === 0 ||
    (e.candidate.licenseSpdx
      ? c.licenses.some((l) => l.toLowerCase() === e.candidate.licenseSpdx!.toLowerCase())
      : false);
  const constraintSatisfaction = clamp01(
    (licenseOk ? 0.5 : 0.1) +
      (e.candidate.isArchived ? 0 : 0.25) +
      recency(e.candidate.pushedAt) * 0.25,
  );

  const repoTypeMatch = c.projectType === "any" ? 0.8 : e.manifests.length ? 0.7 : 0.5;

  const fitComponents = {
    semantic_similarity: clamp01(e.similarity),
    explicit_feature_match: clamp01(featureMatch),
    language_framework_match: langMatch,
    package_manifest_match: manifestMatch,
    constraint_satisfaction: constraintSatisfaction,
    repository_type_match: repoTypeMatch,
  };

  // --- Future components ---
  const releaseCadence = clamp01(
    Math.min(e.releasesLast90, 4) / 4 * 0.6 +
      Math.min(e.releasesLast365, 12) / 12 * 0.2 +
      (e.latestReleaseAt ? recency(e.latestReleaseAt) * 0.2 : 0) +
      (e.hasChangelog ? 0.0 : 0),
  );
  const issuePrHealth = clamp01(
    (e.closedIssues + e.mergedPRs > 0
      ? (e.closedIssues + e.mergedPRs) / (e.closedIssues + e.mergedPRs + e.openIssues + e.openPRs + 1)
      : 0.4) *
      0.7 +
      (e.mergedPRs > 0 ? 0.3 : 0),
  );
  const contributorHealth = clamp01(
    Math.min(e.contributorCount, 20) / 20 * 0.7 + (e.isOrgOwned ? 0.3 : 0.1),
  );
  // Star velocity is approximated for MVP (no stargazer history): weak proxy.
  const starVelocity = clamp01(Math.min(e.candidate.stars, 5000) / 5000 * 0.6);
  const docQuality = docsQuality(e);
  const ecosystemSignal = clamp01(
    (e.manifests.length ? 0.4 : 0) +
      (e.isOrgOwned ? 0.3 : 0.1) +
      Math.min(e.candidate.forks, 500) / 500 * 0.3,
  );

  const futureComponents = {
    recent_activity: recency(e.candidate.pushedAt),
    release_cadence: releaseCadence,
    issue_pr_health: issuePrHealth,
    contributor_health: contributorHealth,
    star_velocity: starVelocity,
    documentation_quality: docQuality,
    ecosystem_signal: ecosystemSignal,
  };

  // --- Risk penalties ---
  const risks: Risk[] = [];
  let penalty = 0;
  if (e.candidate.isArchived) { risks.push({ risk: "Repository is archived", evidence: "GitHub marks this repo archived.", severity: "high" }); penalty += 0.3; }
  if (!e.candidate.licenseSpdx) { risks.push({ risk: "No detected license", evidence: "No SPDX license found.", severity: "medium" }); penalty += 0.1; }
  if (!e.readme) { risks.push({ risk: "No README", evidence: "README could not be fetched.", severity: "medium" }); penalty += 0.1; }
  if (e.releaseCount === 0) { risks.push({ risk: "No releases", evidence: "No tagged releases found.", severity: "low" }); penalty += 0.05; }
  if (daysSince(e.candidate.pushedAt) > 365) { risks.push({ risk: "Stale", evidence: "No push in over 12 months.", severity: "high" }); penalty += 0.2; }
  if (e.contributorCount <= 1) { risks.push({ risk: "Single-maintainer risk", evidence: "One or zero contributors detected.", severity: "medium" }); penalty += 0.1; }

  const fit = weighted(fitComponents, FIT_WEIGHTS);
  const future = clamp01(weighted(futureComponents, FUTURE_WEIGHTS) - penalty);

  // Underrated: high fit/future/docs, recent growth, minus popularity saturation.
  const saturation = clamp01(Math.log10(Math.max(e.candidate.stars, 1)) / 5); // ~0..1 at 100k stars
  const underrated = clamp01(
    fit * 0.35 + future * 0.35 + docQuality * 0.2 + recency(e.candidate.pushedAt) * 0.1 - saturation,
  );

  return {
    repoType: c.projectType === "any" ? (e.manifests.length ? "library" : "app") : c.projectType,
    fit,
    future,
    underrated,
    total: computeTotal(fit, future, underrated),
    fitComponents,
    futureComponents,
    matchedFeatures,
    missingFeatures,
    risks,
    summary: buildSummary(e, fit, future),
    source: "deterministic",
  };
}

function buildSummary(e: RepoEvidence, fit: number, future: number): string {
  const bits: string[] = [];
  bits.push(`${e.candidate.fullName} (${e.candidate.primaryLanguage ?? "unknown language"})`);
  if (e.candidate.licenseSpdx) bits.push(`${e.candidate.licenseSpdx} licensed`);
  bits.push(`${e.candidate.stars} stars`);
  if (e.latestReleaseAt) bits.push(`${e.releasesLast90} releases in last 90 days`);
  bits.push(`fit ${(fit * 100).toFixed(0)}%, future ${(future * 100).toFixed(0)}%`);
  return bits.join("; ") + ".";
}
