"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { getRepoDetail, getRepoTrends } from "@/lib/api/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { ScoreRadarChart, StarTrendChart, RingGauge } from "@/components/charts/Charts";
import { timeAgo } from "@/lib/format";
import type { UiResult } from "@/lib/api/types";

interface Detail {
  repo: {
    fullName: string;
    url: string;
    description: string | null;
    language: string | null;
    license: string | null;
    topics: string[];
    pushedAt: string | null;
    createdAt: string | null;
  };
  readmeExcerpt: string | null;
  latestResult: UiResult | null;
}

export function RepoDetailView({ owner, name }: { owner: string; name: string }) {
  const detailQ = useQuery<Detail>({
    queryKey: ["repo", owner, name],
    queryFn: () => getRepoDetail(owner, name),
  });
  const trendsQ = useQuery({
    queryKey: ["trends", owner, name],
    queryFn: () => getRepoTrends(owner, name),
  });

  if (detailQ.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (detailQ.error || !detailQ.data) {
    return (
      <main className="mx-auto w-full max-w-3xl p-8">
        <BackLink />
        <p className="mt-6 text-muted-foreground">
          This repository hasn&apos;t been analyzed yet. Run a search that surfaces it first.
        </p>
      </main>
    );
  }

  const { repo, readmeExcerpt, latestResult } = detailQ.data;
  const analysis = latestResult?.analysis ?? null;
  const trends = trendsQ.data;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
      <BackLink />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{repo.fullName}</h1>
            <a href={repo.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
              <ExternalLink className="h-5 w-5" />
            </a>
          </div>
          <p className="mt-1 max-w-2xl text-muted-foreground">{repo.description ?? "No description."}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {repo.language && <Badge>{repo.language}</Badge>}
            {repo.license && <Badge>{repo.license}</Badge>}
            <Badge>pushed {timeAgo(repo.pushedAt)}</Badge>
            {repo.topics?.slice(0, 5).map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
        </div>
        {latestResult && (
          <div className="flex items-center gap-3">
            <RingGauge value={latestResult.scores.total} size={72} stroke={6} label="Total" />
            <div className="flex gap-2">
              <ScoreBadge label="Fit" value={latestResult.scores.fit} />
              <ScoreBadge label="Future" value={latestResult.scores.future} />
              <ScoreBadge label="Under" value={latestResult.scores.underrated} />
            </div>
          </div>
        )}
      </div>

      {!latestResult && (
        <p className="mt-8 text-muted-foreground">No analysis stored for this repo yet.</p>
      )}

      {analysis && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader><h2 className="text-sm font-semibold text-muted-foreground">Summary</h2></CardHeader>
              <CardContent><p className="text-sm leading-relaxed">{analysis.summary || "—"}</p></CardContent>
            </Card>

            <Card>
              <CardHeader><h2 className="text-sm font-semibold text-muted-foreground">Score breakdown</h2></CardHeader>
              <CardContent>
                <ScoreBreakdown
                  fitComponents={analysis.fitComponents ?? {}}
                  futureComponents={analysis.futureComponents ?? {}}
                />
              </CardContent>
            </Card>

            <div className="grid gap-6 sm:grid-cols-2">
              <FeatureCard title="Why it matches" tone="emerald"
                items={(analysis.matchedFeatures ?? []).map((f) => ({ head: f.feature, body: f.evidence }))} />
              <FeatureCard title="Missing / weak" tone="rose"
                items={(analysis.missingFeatures ?? []).map((f) => ({ head: f.feature, body: f.reason }))} />
            </div>

            {!!analysis.risks?.length && (
              <Card>
                <CardHeader><h2 className="text-sm font-semibold text-muted-foreground">Risks</h2></CardHeader>
                <CardContent className="space-y-2">
                  {analysis.risks.map((r, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium text-[#f85149]">risk: {r.risk}</span>{" "}
                      <span className="text-muted-foreground">— {r.evidence}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {readmeExcerpt && (
              <Card>
                <CardHeader><h2 className="text-sm font-semibold text-muted-foreground">README evidence</h2></CardHeader>
                <CardContent>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-input p-3 text-xs text-muted-foreground">
                    {readmeExcerpt}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            {trends && (
              <>
                <Card>
                  <CardHeader><h2 className="text-sm font-semibold text-primary">Fit radar</h2></CardHeader>
                  <CardContent><ScoreRadarChart data={trends.fitRadar} color="#58a6ff" /></CardContent>
                </Card>
                <Card>
                  <CardHeader><h2 className="text-sm font-semibold text-accent">Future radar</h2></CardHeader>
                  <CardContent><ScoreRadarChart data={trends.radar} color="#3fb950" /></CardContent>
                </Card>
                <Card>
                  <CardHeader><h2 className="text-sm font-semibold text-muted-foreground">Stars / forks (snapshots)</h2></CardHeader>
                  <CardContent>
                    {trends.starTrend.length > 1 ? (
                      <StarTrendChart data={trends.starTrend} />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Only one snapshot so far — trend builds as the repo is re-analyzed.
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><h2 className="text-sm font-semibold text-muted-foreground">Releases</h2></CardHeader>
                  <CardContent className="text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>{trends.releases.total}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Last 90 days</span><span>{trends.releases.last90}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Last 365 days</span><span>{trends.releases.last365}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Latest</span><span>{timeAgo(trends.releases.latest)}</span></div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function BackLink() {
  return (
    <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
      <ArrowLeft className="h-4 w-4" /> Home
    </Link>
  );
}

function FeatureCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "emerald" | "rose";
  items: { head: string; body: string }[];
}) {
  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold text-muted-foreground">{title}</h2></CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="text-xs">
                <span className="font-medium text-foreground">{it.head}</span>
                <span className="text-muted-foreground"> — {it.body}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None identified.</p>
        )}
      </CardContent>
    </Card>
  );
}
