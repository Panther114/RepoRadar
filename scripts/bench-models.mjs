// Benchmark several OpenRouter models against RepoRadar's real scoring task.
// Usage (PowerShell):  $env:OPENROUTER_API_KEY="..."; node scripts/bench-models.mjs
// The key is read from the environment ONLY — never hard-code it.

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY not set in environment. Aborting.");
  process.exit(1);
}

// Candidate models to compare. TRIALS runs each N times to average latency.
const TRIALS = 2;
const MODELS = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (current)" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B @ Cerebras", provider: { order: ["Cerebras"], allow_fallbacks: true } },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B @ Groq", provider: { order: ["Groq"], allow_fallbacks: true } },
  { id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B @ Groq", provider: { order: ["Groq"], allow_fallbacks: true } },
  { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B", provider: { order: ["Cerebras", "Groq"], allow_fallbacks: true } },
  { id: "openai/gpt-4o-mini", label: "GPT-4o-mini" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3 (old baseline)", trials: 1 },
];

// ── The real scoring prompt from src/lib/llm/score.ts ──────────────────────
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

// Representative evidence: a real-ish Rust async web framework repo.
const USER = `USER INTENT:
${JSON.stringify({
  prompt: "Rust async web framework",
  constraints: { keywords: ["rust", "async", "web", "framework", "http"], requiredFeatures: ["async", "routing", "middleware"], language: "Rust", licenses: [], projectType: "framework", includeSmallProjects: false },
})}

REPOSITORY EVIDENCE:
${JSON.stringify({
  fullName: "tokio-rs/axum",
  description: "Ergonomic and modular web framework built with Tokio, Tower, and Hyper",
  language: "Rust",
  license: "MIT",
  topics: ["rust", "http", "web", "async", "framework"],
  stars: 18500,
  forks: 1050,
  daysSinceLastPush: 3,
  isArchived: false,
  embeddingSimilarity: 0.82,
  manifests: [{ file: "Cargo.toml", ecosystem: "cargo", deps: 24 }],
  releases: { total: 60, last90: 4, last365: 14, latest: "2026-05-20", changelog: true },
  issuesPrs: { openIssues: 110, closedIssues: 1800, openPRs: 25, mergedPRs: 2200 },
  contributors: 320,
  orgOwned: true,
  docs: { hasReadme: true, hasDocsDir: true, hasExamples: true },
  readmeExcerpt: "axum is a web application framework that focuses on ergonomics and modularity. High level features: Route requests to handlers with a macro-free API. Declaratively parse requests using extractors. Simple and predictable error handling model. Generate responses with minimal boilerplate. Take full advantage of the tower and tower-http ecosystem of middleware, services, and utilities. axum doesn't have its own middleware system but instead uses tower::Service. This means axum gets timeouts, tracing, compression, authorization, and more, for free.",
}).slice(0, 4000)}`;

async function callModel(m) {
  const body = {
    model: m.id,
    temperature: 0.2,
    max_tokens: 1300,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
  };
  if (m.provider) body.provider = m.provider;

  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/reporadar/reporadar",
        "X-Title": "RepoRadar-Bench",
      },
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (err) {
    return { ms: Date.now() - t0, ok: false, error: String(err) };
  }
  const ms = Date.now() - t0;

  if (!res.ok) return { ms, ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ms, ok: false, error: `Non-JSON response: ${text.slice(0, 300)}` };
  }
  const content = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage;

  // Parse the model's JSON scores.
  let parsed = null;
  try {
    let s = content.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    parsed = JSON.parse(s);
  } catch {
    parsed = null;
  }

  return { ms, ok: true, usage, parsed, raw: content };
}

async function main() {
  console.log(`\nBenchmarking ${MODELS.length} models on the real scoring prompt (${TRIALS} trials each)\n${"=".repeat(72)}`);
  const rows = [];
  for (const m of MODELS) {
    const n = m.trials ?? TRIALS;
    process.stdout.write(`\n▶ ${m.label} ... `);
    const times = [];
    let last = null;
    for (let i = 0; i < n; i++) {
      const r = await callModel(m);
      last = r;
      if (r.ok) times.push(r.ms);
    }
    if (!last.ok) {
      console.log(`FAILED\n   ${last.error}`);
      rows.push({ label: m.label, ms: Infinity, status: "FAIL" });
      continue;
    }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const p = last.parsed;
    const validJson = p && typeof p.fit === "number";
    console.log(`avg ${avg}ms  (trials: ${times.join(", ")})`);
    if (validJson) {
      console.log(`   fit=${p.fit?.toFixed?.(2)} future=${p.future?.toFixed?.(2)} underrated=${p.underrated?.toFixed?.(2)}  | ${(p.summary ?? "").slice(0, 90)}`);
    } else {
      console.log(`   ⚠ JSON shape invalid. raw head: ${last.raw.slice(0, 140)}`);
    }
    rows.push({ label: m.label, ms: avg, status: validJson ? "OK" : "BAD-JSON", fit: p?.fit, future: p?.future, underrated: p?.underrated });
  }

  console.log(`\n${"=".repeat(72)}\nSUMMARY (sorted by avg latency)\n`);
  rows.sort((a, b) => a.ms - b.ms);
  for (const r of rows) {
    const ms = r.ms === Infinity ? "  FAIL" : `${String(r.ms).padStart(6)}ms`;
    console.log(`  ${ms}  ${r.status.padEnd(8)}  fit=${r.fit?.toFixed?.(2) ?? "—"} fut=${r.future?.toFixed?.(2) ?? "—"} und=${r.underrated?.toFixed?.(2) ?? "—"}  ${r.label}`);
  }
  console.log();
}

main();
