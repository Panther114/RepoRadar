import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLanguagePolicy,
  expandQuerySet,
  stripUnsafeQualifiers,
} from "../src/lib/search/queryPolicy";
import { findGuidanceHints, guidanceCanonicalNames } from "../src/lib/search/guidance";
import { normalizeCanonicalNames } from "../src/lib/search/canonical";
import { detectReferences } from "../src/lib/search/referenceDetect";
import { passesInjectionGate } from "../src/lib/search/sourceGate";
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

  it("does not encode gold-set domains as canonical guidance", () => {
    assert.deepEqual(guidanceCanonicalNames("react data table"), []);
    assert.deepEqual(guidanceCanonicalNames("kubernetes monitoring and observability"), []);
    const rustNames = guidanceCanonicalNames("rust web framework");
    assert(!rustNames.includes("tokio-rs/axum"));
    assert(!rustNames.includes("actix/actix-web"));
    assert(!rustNames.includes("rwf2/Rocket"));
    const pythonNames = guidanceCanonicalNames("python data validation library");
    assert(!pythonNames.includes("pydantic/pydantic"));
    assert(!pythonNames.includes("python-jsonschema/jsonschema"));
    assert(!pythonNames.includes("marshmallow-code/marshmallow"));
  });

  it("requires domain evidence before broad guidance fires", () => {
    assert.deepEqual(findGuidanceHints("self hosted analytics").map((hint) => hint.id), []);
    assert(findGuidanceHints("self hosted deploy").some((hint) => hint.id === "self-hosted-deploy"));
    assert.deepEqual(findGuidanceHints("react data table").map((hint) => hint.id), []);
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

  it("keeps benchmark prompts short and hard-caps limit at ten", () => {
    assert(BENCHMARK_PROMPTS.length <= 10);
    assert(BENCHMARK_PROMPTS.every((p) => p.prompt.split(/\s+/).length <= 5));
    assert(BENCHMARK_PROMPTS.some((p) => p.forbidden?.length));
    assert.equal(clampBenchmarkLimit(999), 10);
    assert.equal(clampBenchmarkLimit(undefined), 6);
  });

  it("normalizes redirected canonical names to the fetched repo full name", () => {
    const normalized = normalizeCanonicalNames(
      ["samuelcolvin/pydantic", "python-jsonschema/jsonschema"],
      [
        candidate(1, "pydantic/pydantic", 25000),
        candidate(2, "python-jsonschema/jsonschema", 4500),
      ],
      ["pydantic/pydantic"],
    );

    assert.deepEqual(normalized, ["pydantic/pydantic", "python-jsonschema/jsonschema"]);
  });
});

describe("reference detection (v1.1.4)", () => {
  it("detects 'alternative to X' references", () => {
    assert.deepEqual(detectReferences("open source alternative to firebase"), ["firebase"]);
    assert.deepEqual(detectReferences("alternatives to airtable"), ["airtable"]);
  });

  it("detects 'X alternative' and 'like X' phrasings", () => {
    assert.deepEqual(detectReferences("self hosted notion alternative"), ["notion"]);
    assert.deepEqual(detectReferences("something like supabase but lighter"), ["supabase"]);
    assert.deepEqual(detectReferences("stripe clone"), ["stripe"]);
    assert.deepEqual(detectReferences("a notion-like editor"), ["notion"]);
  });

  it("ignores generic words and non-reference prompts", () => {
    assert.deepEqual(detectReferences("react data table with virtual scrolling"), []);
    assert.deepEqual(detectReferences("rust web framework"), []);
    assert.deepEqual(detectReferences("kubernetes monitoring dashboard"), []);
    // "open source alternatives" with no named project must not capture "open".
    assert.deepEqual(detectReferences("good open source alternatives"), []);
  });

  it("keeps dotted/hyphenated names intact", () => {
    assert.deepEqual(detectReferences("alternative to next.js"), ["next.js"]);
  });
});

describe("source injection gate (v1.1.4)", () => {
  const recent = new Date(Date.now() - 30 * 86400_000).toISOString();
  const stale = new Date(Date.now() - 3 * 365 * 86400_000).toISOString();
  const base = (over: Partial<Candidate>): Candidate => ({
    ...candidate(1, "acme/grid", 500),
    description: "Headless data table library for React",
    topics: ["react", "table", "datagrid"],
    pushedAt: recent,
    ...over,
  });
  const kws = ["react", "data table", "datagrid"];

  it("admits topical, alive, credible repos", () => {
    assert.equal(passesInjectionGate(base({}), kws, false), true);
  });

  it("rejects off-topic repos regardless of stars", () => {
    const offTopic = base({ description: "Kubernetes operator for backups", topics: ["k8s"], fullName: "acme/op", name: "op" });
    assert.equal(passesInjectionGate(offTopic, kws, false), false);
  });

  it("rejects low-star repos unless small projects were requested", () => {
    const small = base({ stars: 10 });
    assert.equal(passesInjectionGate(small, kws, false), false);
    assert.equal(passesInjectionGate(small, kws, true), true);
  });

  it("rejects repos not pushed within two years", () => {
    assert.equal(passesInjectionGate(base({ pushedAt: stale }), kws, false), false);
    assert.equal(passesInjectionGate(base({ pushedAt: null }), kws, false), false);
  });

  it("admits on a verbatim multi-word keyword phrase", () => {
    const phraseOnly = base({ fullName: "x/y", name: "y", description: "the fastest data table around", topics: [] });
    assert.equal(passesInjectionGate(phraseOnly, kws, false), true);
  });
});
