import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Brain,
  GitBranch,
  GitFork,
  Layers,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

export const metadata: Metadata = {
  title: "About — RepoRadar",
  description:
    "How RepoRadar searches GitHub, ranks repositories, and composes Fit, Future, and Underrated scores.",
};

const PIPELINE = [
  {
    step: "01",
    icon: Brain,
    title: "Intent extraction",
    desc: "Your plain-English query is enriched by an LLM into a structured set of constraints — language, project type, features, and orthogonal search aspects — so even short prompts produce precise results.",
  },
  {
    step: "02",
    icon: Search,
    title: "Multi-axis GitHub search",
    desc: "Up to 8 diverse GitHub search queries are generated from the constraints. Each strategy targets a different angle (feature keywords, topic tags, description phrases) to maximise candidate recall without blowing the API budget.",
  },
  {
    step: "03",
    icon: Layers,
    title: "Embedding funnel",
    desc: "Candidates are narrowed with local ONNX embeddings (all-MiniLM-L6-v2, 384-dim, runs in-process). Each repo is scored against every aspect of your query using a conjunctive formula — a repo that misses any axis sinks, regardless of how well it scores on the others.",
  },
  {
    step: "04",
    icon: GitFork,
    title: "GraphQL enrichment",
    desc: "The top survivors are batched into a single GitHub GraphQL query that fetches README, manifests, releases, issue health, and contributor data in one round-trip. This evidence is what the scoring engine reads.",
  },
  {
    step: "05",
    icon: BarChart3,
    title: "Deterministic scoring",
    desc: "Fit, Future, and Underrated scores are computed in code — no LLM black-box. Each component is a weighted sub-score derived from the enriched evidence, so the same repo always produces the same numbers.",
  },
  {
    step: "06",
    icon: Sparkles,
    title: "LLM explanation",
    desc: "A fast, cheap model writes a 1-sentence rationale for each result — why it fits, what it's missing, what risks exist. The numbers come first; the prose adds colour, not decisions.",
  },
];

const SCORES = [
  {
    name: "Fit",
    icon: Search,
    color: "text-primary",
    ring: "ring-primary/20 bg-primary/5",
    bar: "bg-primary",
    tagline: "Semantic relevance to your query",
    desc: "Measures how closely a repository matches what you described — combining embedding similarity, explicit feature overlap, language match, and constraint satisfaction.",
    weights: [
      { label: "Semantic similarity (embeddings)", pct: 40 },
      { label: "Explicit feature match", pct: 20 },
      { label: "Language / framework match", pct: 15 },
      { label: "Manifest / package signals", pct: 10 },
      { label: "Constraint satisfaction", pct: 10 },
      { label: "Repository type match", pct: 5 },
    ],
  },
  {
    name: "Future",
    icon: ShieldCheck,
    color: "text-accent",
    ring: "ring-accent/20 bg-accent/5",
    bar: "bg-accent",
    tagline: "Long-term maintenance health",
    desc: "Estimates how likely a repository is to stay useful — based on activity recency, release cadence, issue/PR health, contributor diversity, and star velocity. Risk penalties apply.",
    weights: [
      { label: "Recent commit / push activity", pct: 25 },
      { label: "Release cadence", pct: 20 },
      { label: "Issue & PR health", pct: 20 },
      { label: "Contributor breadth", pct: 15 },
      { label: "Star velocity trend", pct: 10 },
      { label: "Docs quality + ecosystem signals", pct: 10 },
    ],
  },
  {
    name: "Underrated",
    icon: TrendingUp,
    color: "text-[#d29922]",
    ring: "ring-[#d29922]/20 bg-[#d29922]/5",
    bar: "bg-[#d29922]",
    tagline: "Hidden quality before it's famous",
    desc: "Surfaces strong projects that haven't hit mainstream attention yet. A high Fit and Future score with lower popularity and recent growth momentum pushes this score up.",
    weights: [
      { label: "High fit score", pct: 35 },
      { label: "High future score", pct: 30 },
      { label: "Recent growth momentum", pct: 20 },
      { label: "Minus popularity saturation", pct: 15 },
    ],
  },
];

const PRINCIPLES = [
  {
    icon: Zap,
    title: "Fast by default",
    desc: "Local ONNX embeddings, batched GraphQL, and a cheap LLM for scoring keep the full pipeline under 35 seconds on cold searches.",
  },
  {
    icon: ShieldCheck,
    title: "Explainable scores",
    desc: "Every number is computed in code, not inferred. The same inputs always produce the same score, so you can reason about the ranking.",
  },
  {
    icon: GitBranch,
    title: "No black boxes",
    desc: "The LLM is used only for intent enrichment and one-sentence rationales. The ranking itself is deterministic and auditable.",
  },
  {
    icon: Radar,
    title: "Aspect-aware ranking",
    desc: "Multi-facet queries are decomposed into orthogonal aspects. Missing any single axis tanks the score — so results satisfy all of your criteria, not just the loudest one.",
  },
];

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 space-y-16">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <Radar className="h-3.5 w-3.5 text-primary" />
          About RepoRadar
        </div>
        <h1 className="text-4xl font-semibold tracking-tight leading-[1.1] sm:text-5xl">
          GitHub search built for<br />
          <span className="text-primary">developers, not search engines.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
          Finding the right open-source library is hard. GitHub keyword search returns the most
          starred results — not the most relevant ones. You end up sifting through abandoned
          projects, wrong languages, and repos that match three words in your query but miss the
          point entirely.
        </p>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          RepoRadar takes a plain-English description of what you need and returns a ranked,
          evidence-backed shortlist. Every score is computed transparently, every result is
          explained, and you can judge the reasoning yourself.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-[#010409] transition-opacity hover:opacity-90"
          >
            <Search className="h-4 w-4" />
            Try a search
          </Link>
          <Link
            href="/#how-it-works"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-[#21262d] hover:text-foreground"
          >
            How it works
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────────────────── */}
      <section>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Keyword search returns starred, not relevant", sub: "GitHub ranks by stars. You need fit." },
            { label: "No signal on whether a project is maintained", sub: "Stars don't tell you if it was last touched in 2021." },
            { label: "No way to surface underrated gems early", sub: "New quality projects get buried behind incumbents." },
          ].map((p) => (
            <div
              key={p.label}
              className="rounded-lg border border-border bg-card p-4 space-y-1"
            >
              <p className="text-sm font-medium text-foreground">{p.label}</p>
              <p className="text-xs leading-5 text-muted-foreground">{p.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <section id="how-it-works">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">How a search works</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
            Six stages from your prompt to a ranked shortlist — each one adds signal, strips noise.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((stage) => (
            <div
              key={stage.step}
              className="relative rounded-lg border border-border bg-card p-4 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-input">
                  <stage.icon className="h-4 w-4 text-primary" />
                </div>
                <span className="font-mono text-[11px] text-muted-foreground/40 mt-1">
                  {stage.step}
                </span>
              </div>
              <h3 className="text-sm font-semibold">{stage.title}</h3>
              <p className="text-xs leading-5 text-muted-foreground">{stage.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Cold searches typically complete in 30–40 seconds. Warm searches (where candidates and
          enrichment data are cached) are significantly faster.
        </p>
      </section>

      {/* ── Scores ───────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">Scoring criteria</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
            Three scores, each deterministic and code-computed. No LLM decides the numbers.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {SCORES.map((score) => (
            <div
              key={score.name}
              className={`rounded-lg border border-border ring-1 ${score.ring} p-5 space-y-4`}
            >
              <div className="flex items-center gap-2.5">
                <score.icon className={`h-5 w-5 ${score.color}`} />
                <div>
                  <div className="text-base font-semibold">{score.name}</div>
                  <div className="text-[11px] text-muted-foreground">{score.tagline}</div>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{score.desc}</p>
              <div className="space-y-2.5 pt-1 border-t border-border">
                {score.weights.map((w) => (
                  <div key={w.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">{w.label}</span>
                      <span className="font-mono text-[11px] text-foreground">{w.pct}%</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-border/60">
                      <div
                        className={`h-1 rounded-full ${score.bar} opacity-80`}
                        style={{ width: `${w.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Principles ───────────────────────────────────────────────────── */}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">Design principles</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
            The decisions behind the architecture.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div
              key={p.title}
              className="flex gap-3.5 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-input">
                <p.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{p.title}</p>
                <p className="text-xs leading-5 text-muted-foreground">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Ready to find what you need?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Describe a repository in plain English and get a ranked, evidence-backed shortlist.
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-[#010409] transition-opacity hover:opacity-90"
        >
          <Search className="h-4 w-4" />
          Search now
        </Link>
      </section>

    </main>
  );
}
