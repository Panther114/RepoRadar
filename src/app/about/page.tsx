import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, GitBranch, Radar, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "About RepoRadar",
  description:
    "How RepoRadar searches GitHub, ranks repositories, and composes Fit, Future, and Underrated scores.",
};

const SCORE_BREAKDOWN = [
  {
    name: "Fit",
    icon: Search,
    tone: "text-primary",
    headline: "What the repo actually does.",
    items: [
      "40% semantic similarity between your prompt and repo evidence",
      "20% explicit feature match",
      "15% language/framework match",
      "10% manifest/package match",
      "10% constraint satisfaction",
      "5% repository type match",
    ],
  },
  {
    name: "Future",
    icon: ShieldCheck,
    tone: "text-accent",
    headline: "How likely it is to stay useful.",
    items: [
      "Recent activity",
      "Release cadence",
      "Issue/PR health",
      "Contributor health",
      "Star velocity",
      "Documentation quality",
      "Ecosystem signal",
      "Minus risk penalties",
    ],
  },
  {
    name: "Underrated",
    icon: Sparkles,
    tone: "text-[#d29922]",
    headline: "Good projects that deserve more visibility.",
    items: [
      "High fit",
      "High future score",
      "Strong docs",
      "Recent growth",
      "Minus popularity saturation",
    ],
  },
];

const FLOW = [
  "You describe what kind of repository you need.",
  "RepoRadar expands that into several GitHub-compatible queries.",
  "GitHub search returns candidates, which are deduped and filtered.",
  "A deterministic funnel narrows the pool with local embeddings and cheap signals.",
  "The survivors are enriched with README, manifests, releases, issues, and contributor evidence.",
  "The final rank is explained with transparent scores and evidence-backed reasoning.",
];

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="max-w-3xl">
        <Badge className="mb-3">
          <Radar className="h-3 w-3 text-primary" />
          About RepoRadar
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          What it does, how it ranks, and why the scores are explainable.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          RepoRadar searches GitHub by intent, not keywords. It keeps the interface compact, the
          scoring transparent, and the evidence visible so users can judge the result instead of
          trusting a black box.
        </p>
      </div>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                <GitBranch className="h-3.5 w-3.5 text-primary" />
              </div>
              <h2 className="text-sm font-semibold">How the search works</h2>
            </div>
            <ol className="space-y-2 text-sm leading-6 text-muted-foreground">
              {FLOW.map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-input text-[11px] text-foreground">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Fresh searches usually take about 40 seconds. Repeated searches are often faster
              because candidate and enrichment data can be cached.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#238636]/10">
                <BarChart3 className="h-3.5 w-3.5 text-accent" />
              </div>
              <h2 className="text-sm font-semibold">What you get back</h2>
            </div>
            <div className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                Every result includes rank, Fit, Future, and Underrated scores, plus matched
                features, missing features, risks, repository metadata, and evidence snippets.
              </p>
              <p>
                The model is used for explanation and classification. The numeric scores are
                computed in code so they stay auditable and consistent.
              </p>
            </div>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-[#21262d] hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
              Back to search
            </Link>
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold">How scores are composed</h2>
          <span className="text-xs text-muted-foreground">transparent, code-backed weighting</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {SCORE_BREAKDOWN.map((score) => (
            <Card key={score.name}>
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <score.icon className={`h-4 w-4 ${score.tone}`} />
                  <h3 className="text-sm font-semibold">{score.name}</h3>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">{score.headline}</p>
                <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
                  {score.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
