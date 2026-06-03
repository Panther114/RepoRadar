import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLanguagePolicy,
  expandQuerySet,
  stripUnsafeQualifiers,
} from "../src/lib/search/queryPolicy";
import { findGuidanceHints } from "../src/lib/search/guidance";
import { fuseCandidateSources } from "../src/lib/search/candidateFusion";
import { applyListwiseRanking } from "../src/lib/llm/listwise";
import { BENCHMARK_PROMPTS, clampBenchmarkLimit } from "../scripts/search-benchmark.mjs";
import type { Candidate, Intent, RepoEvidence } from "../src/lib/types";

function candidate(id: number, fullName: string, stars = 100): Candidate {
  const [owner, name] = fullName.split("/");
  return {
    githubId: id,
    fullName,
    owner,
    name,
    htmlUrl: `https://github.com/${fullName}`,
    description: null,
    primaryLanguage: null,
    licenseSpdx: null,
    topics: [],
    isArchived: false,
    isFork: false,
    stars,
    forks: 0,
    openIssues: 0,
    watchers: stars,
    createdAt: null,
    updatedAt: null,
    pushedAt: null,
  };
}

function evidence(c: Candidate): RepoEvidence {
  return {
    candidate: c,
    readme: null,
    readmeHash: null,
    manifests: [],
    releaseCount: 0,
    latestReleaseAt: null,
    releasesLast90: 0,
    releasesLast365: 0,
    hasChangelog: false,
    openIssues: c.openIssues,
    closedIssues: 0,
    openPRs: 0,
    mergedPRs: 0,
    contributorCount: 0,
    isOrgOwned: false,
    docsSignals: {
      hasInstall: false,
      hasQuickstart: false,
      hasExamples: false,
      hasApiDocs: false,
      hasDocsFolder: false,
      hasWebsite: false,
      readmeLength: 0,
    },
    similarity: 0.7,
  };
}

const baseIntent: Intent = {
  normalizedPrompt: "javascript editor",
  constraints: {
    keywords: ["javascript", "editor", "tiptap", "lexical"],
    requiredFeatures: ["editor"],
    aspects: ["rich text editor"],
    language: null,
    licenses: [],
    pushedWithinDays: null,
    projectType: "library",
    includeSmallProjects: false,
    minStars: null,
    maxStars: null,
  },
  queries: ["tiptap OR lexical language:JavaScript stars:<1000"],
};

describe("search quality policy", () => {
  it("treats ecosystem language mentions as soft unless the prompt says must", () => {
    assert.equal(buildLanguagePolicy("javascript editor").hardLanguage, null);
    assert.equal(buildLanguagePolicy("must be written in Python").hardLanguage, "Python");
  });

  it("strips unsafe hard qualifiers but preserves explicit language filters", () => {
    const soft = buildLanguagePolicy("javascript editor");
    assert.equal(stripUnsafeQualifiers("editor language:JavaScript stars:<1000", soft), "editor");

    const hard = buildLanguagePolicy("must be written in Python");
    assert.equal(stripUnsafeQualifiers("api language:JavaScript stars:<1000", hard), "api language:Python");
  });

  it("expands short vague prompts with guidance and open no-language variants", () => {
    const hints = findGuidanceHints("browser testing");
    const queries = expandQuerySet({
      rawPrompt: "browser testing",
      intent: {
        ...baseIntent,
        normalizedPrompt: "browser testing",
        constraints: { ...baseIntent.constraints, keywords: ["browser", "testing", "playwright"] },
        queries: ["browser testing"],
      },
      guidanceHints: hints,
      canonicalNames: ["microsoft/playwright"],
    });

    assert(queries.some((q) => /playwright/i.test(q)));
    assert(queries.some((q) => /sort:stars/i.test(q)));
    assert(queries.some((q) => !/language:/i.test(q)));
    assert(queries.length <= 10);
  });

  it("uses retrieval fusion to keep candidates from later query sources in the pool", () => {
    const fused = fuseCandidateSources([
      { query: "browser testing", candidates: [candidate(1, "SeleniumHQ/selenium"), candidate(2, "puppeteer/puppeteer")] },
      { query: "playwright", candidates: [candidate(3, "microsoft/playwright"), candidate(2, "puppeteer/puppeteer")] },
    ], 3);

    assert.deepEqual(fused.map((c) => c.fullName).sort(), [
      "SeleniumHQ/selenium",
      "microsoft/playwright",
      "puppeteer/puppeteer",
    ].sort());
  });

  it("applies listwise ordering without changing baseline health metadata", () => {
    const a = candidate(1, "generic/tutorial", 10);
    const b = candidate(2, "microsoft/playwright", 70000);
    const ranked = applyListwiseRanking({
      evidences: [evidence(a), evidence(b)],
      baselines: [
        {
          repoType: "tutorial",
          fit: 0.5,
          future: 0.2,
          underrated: 0.1,
          total: 0.4,
          fitComponents: {},
          futureComponents: {},
          matchedFeatures: [],
          missingFeatures: [],
          risks: [],
          summary: "",
          source: "deterministic",
        },
        {
          repoType: "library",
          fit: 0.7,
          future: 0.9,
          underrated: 0.1,
          total: 0.75,
          fitComponents: {},
          futureComponents: {},
          matchedFeatures: [],
          missingFeatures: [],
          risks: [],
          summary: "",
          source: "deterministic",
        },
      ],
      listwise: [
        {
          fullName: "microsoft/playwright",
          rank: 1,
          fit: 0.95,
          relevant: true,
          repoTypes: [{ type: "library", confidence: 0.9 }],
          summary: "Best match for browser testing.",
        },
      ],
    });

    assert.equal(ranked[0].evidence.candidate.fullName, "microsoft/playwright");
    assert.equal(ranked[0].analysis.future, 0.9);
    assert.equal(ranked[0].analysis.source, "ai");
  });

  it("demotes repos the listwise model flags as irrelevant below relevant ones", () => {
    const onTopic = candidate(1, "microsoft/playwright", 70000);
    const offTopic = candidate(2, "pmndrs/zustand", 50000);
    const ranked = applyListwiseRanking({
      evidences: [evidence(offTopic), evidence(onTopic)],
      baselines: [
        { repoType: "library", fit: 0.6, future: 0.9, underrated: 0.1, total: 0.6, fitComponents: {}, futureComponents: {}, matchedFeatures: [], missingFeatures: [], risks: [], summary: "", source: "deterministic" },
        { repoType: "library", fit: 0.6, future: 0.9, underrated: 0.1, total: 0.6, fitComponents: {}, futureComponents: {}, matchedFeatures: [], missingFeatures: [], risks: [], summary: "", source: "deterministic" },
      ],
      listwise: [
        { fullName: "pmndrs/zustand", rank: 1, fit: 0.8, relevant: false, repoTypes: [{ type: "library", confidence: 0.9 }], summary: "Off topic." },
        { fullName: "microsoft/playwright", rank: 2, fit: 0.7, relevant: true, repoTypes: [{ type: "library", confidence: 0.9 }], summary: "On topic." },
      ],
    });

    // Despite a lower rank number, the relevant repo must come first.
    assert.equal(ranked[0].evidence.candidate.fullName, "microsoft/playwright");
    assert.equal(ranked[1].evidence.candidate.fullName, "pmndrs/zustand");
    assert(ranked[1].analysis.fit <= 0.4);
  });

  it("keeps benchmark prompts short and hard-caps limit at ten", () => {
    assert(BENCHMARK_PROMPTS.length <= 10);
    assert(BENCHMARK_PROMPTS.every((p) => p.prompt.split(/\s+/).length <= 5));
    assert.equal(clampBenchmarkLimit(999), 10);
    assert.equal(clampBenchmarkLimit(undefined), 6);
  });
});
