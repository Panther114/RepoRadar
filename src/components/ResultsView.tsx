"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
import { getSearch } from "@/lib/api/client";
import type { UiResult } from "@/lib/api/types";
import { RepoCard } from "@/components/RepoCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { pct, scoreColor } from "@/components/ScoreBadge";
import { ownerNameFromFullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const RISK_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

function riskScore(r: UiResult): number {
  return (r.analysis?.risks ?? []).reduce((s, x) => s + (RISK_WEIGHT[x.severity] ?? 1), 0);
}

function best(results: UiResult[], score: (r: UiResult) => number): UiResult | null {
  if (!results.length) return null;
  return [...results].sort((a, b) => score(b) - score(a))[0];
}

export function ResultsView({ searchId }: { searchId: string }) {
  const { data, error } = useQuery({
    queryKey: ["search", searchId],
    queryFn: () => getSearch(searchId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "completed" || s === "failed" ? false : 1500;
    },
  });

  const [selected, setSelected] = useState<string[]>([]);
  const results = data?.results ?? [];

  const maxStars = useMemo(
    () => results.reduce((m, r) => Math.max(m, r.metrics?.stars ?? 0), 0),
    [results],
  );

  const rails = useMemo(() => {
    if (!results.length) return [];
    return [
      { label: "Best Overall", r: best(results, (r) => r.scores.total ?? 0), tone: "primary" },
      { label: "Best Maintained", r: best(results, (r) => r.scores.future ?? 0), tone: "accent" },
      { label: "Best Underrated", r: best(results, (r) => r.scores.underrated ?? 0), tone: "primary" },
      {
        label: "Best Documentation",
        r: best(results, (r) => r.analysis?.futureComponents?.documentation_quality ?? 0),
        tone: "accent",
      },
      { label: "Lowest Risk", r: best(results, (r) => -riskScore(r)), tone: "primary" },
    ].filter((x) => x.r);
  }, [results]);

  const underrated = useMemo(
    () =>
      [...results]
        .filter((r) => (r.scores.underrated ?? 0) >= 0.5)
        .sort((a, b) => (b.scores.underrated ?? 0) - (a.scores.underrated ?? 0))
        .slice(0, 4),
    [results],
  );

  const toggleSelect = (fullName: string) =>
    setSelected((cur) =>
      cur.includes(fullName) ? cur.filter((x) => x !== fullName) : [...cur, fullName].slice(-5),
    );

  const running = data && (data.status === "queued" || data.status === "running");
  const compareResults = results.filter((r) => selected.includes(r.repo.fullName));

  const constraints = data?.constraints as Record<string, unknown> | null;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
      {/* -- Search header ----------------------------------------------- */}
      <div className="animate-in mb-4">
        <div className="mb-2 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-[#21262d] hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> New search
          </Link>
          {data?.prompt && (
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={data.prompt}>
              &quot;{data.prompt}&quot;
            </h1>
          )}
        </div>
        {constraints && (
          <div className="flex flex-wrap gap-1.5">
            {!!constraints.language && (
              <span className="rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                {String(constraints.language)}
              </span>
            )}
            {!!constraints.projectType && constraints.projectType !== "any" && (
              <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
                {String(constraints.projectType)}
              </span>
            )}
            {Array.isArray(constraints.licenses) && constraints.licenses.map((l) => (
              <span key={String(l)} className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
                {String(l)}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <Card className="mb-6 border-[#f85149]/40">
          <CardContent className="p-4 text-sm text-[#f85149]">
            Could not reach the server. Is <code className="font-mono">pnpm dev</code> running?
          </CardContent>
        </Card>
      )}

      {running && (
        <>
          <SearchProgress stage={data?.stage} status={data?.status} progress={data?.progress ?? 0} />
          {results.length === 0 && <ResultSkeletons />}
        </>
      )}

      {data?.status === "failed" && (
        <Card className="mb-6 border-[#f85149]/40 bg-[#f85149]/10">
          <CardContent className="p-4">
            <p className="mb-2 font-semibold text-[#f85149]">Search failed</p>
            {data.stage && (
              <p className="mb-2 text-xs text-[#f85149]/80">
                Failed at stage: <span className="font-mono">{data.stage}</span>
              </p>
            )}
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-input p-3 text-xs text-[#f85149]">
              {data.error ?? "Unknown error — check server logs"}
            </pre>
            <p className="mt-3 text-xs text-muted-foreground">
              Full logs: <code className="font-mono">logs/pipeline.log</code> in the project root.
              Run <code className="font-mono">node scripts/cli.mjs health</code> to check system status.
            </p>
          </CardContent>
        </Card>
      )}

      {!running && results.length === 0 && data?.status === "completed" && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <p className="font-medium">No repositories found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a broader prompt or fewer filters.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-[#21262d] hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Try again
            </Link>
          </CardContent>
        </Card>
      )}

      {rails.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {rails.map((x) => {
            const [o, n] = ownerNameFromFullName(x.r!.repo.fullName);
            return (
              <Link
                key={x.label}
                href={`/repo/${o}/${n}`}
                className={cn(
                  "card-hover group animate-in rounded-md border bg-card p-2.5",
                  x.tone === "accent" ? "border-[#2ea043]/40" : "border-border",
                )}
              >
                <div
                  className={cn(
                    "text-[10px] font-medium",
                    x.tone === "accent" ? "text-accent" : "text-primary",
                  )}
                >
                  {x.label}
                </div>
                <div className="mt-1 truncate text-sm font-medium group-hover:text-primary" title={x.r!.repo.fullName}>
                  {x.r!.repo.fullName.split("/")[1] ?? x.r!.repo.fullName}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {x.r!.repo.fullName.split("/")[0]}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {underrated.length > 0 && (
        <section className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[#238636]/10">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">
              Hidden gems
            </h2>
            <span className="rounded-md border border-[#2ea043]/40 bg-[#238636]/10 px-1.5 py-0.5 text-[11px] text-accent">
              {underrated.length}
            </span>
            <span className="text-xs text-muted-foreground">
              high signal, low fame
            </span>
          </div>
          <div className="space-y-2">
            {underrated.map((r, i) => (
              <div key={`u-${r.repo.fullName}`} style={{ animationDelay: `${i * 60}ms` }}>
                <RepoCard
                  result={r}
                  selected={selected.includes(r.repo.fullName)}
                  onToggleSelect={toggleSelect}
                  maxStars={maxStars}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              All results
            </h2>
            <span className="rounded-md border border-border bg-input px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {results.length}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">ranked by total score</span>
          </div>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={r.repo.fullName} style={{ animationDelay: `${i * 40}ms` }}>
                <RepoCard
                  result={r}
                  selected={selected.includes(r.repo.fullName)}
                  onToggleSelect={toggleSelect}
                  maxStars={maxStars}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {compareResults.length >= 2 && (
        <CompareTable results={compareResults} onClear={() => setSelected([])} />
      )}
    </main>
  );
}

const PIPELINE_STAGES = [
  { key: "intent", label: "Understanding your request" },
  { key: "search", label: "Searching GitHub" },
  { key: "funnel", label: "Narrowing candidates" },
  { key: "enrich", label: "Gathering evidence" },
  { key: "score", label: "Scoring & explaining with AI" },
];

function stageIndex(stage: string | null | undefined): number {
  if (!stage) return 0;
  const key = stage.split(" ")[0];
  const i = PIPELINE_STAGES.findIndex((s) => s.key === key);
  if (key === "done") return PIPELINE_STAGES.length;
  return i === -1 ? 0 : i;
}

function SearchProgress({
  stage,
  status,
  progress,
}: {
  stage?: string | null;
  status?: string | null;
  progress: number;
}) {
  const active = status === "queued" ? -1 : stageIndex(stage);
  // Surface the "score 7/15" counter if present.
  const counter = stage && /\s\d+\/\d+$/.test(stage) ? stage.split(" ").pop() : null;

  return (
    <Card className="mb-4 animate-in overflow-hidden">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30 pulse-ring">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </span>
          <div>
            <div className="text-sm font-semibold">Scanning the ecosystem…</div>
            <div className="text-xs text-muted-foreground">
              {active >= 0 && active < PIPELINE_STAGES.length
                ? PIPELINE_STAGES[active].label
                : "Starting up"}
              {counter && <span className="text-primary"> · {counter}</span>}
            </div>
          </div>
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">{progress}%</span>
        </div>

        <div className="shimmer mb-4 h-1.5 overflow-hidden rounded-full bg-input">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${Math.max(progress, 4)}%` }}
          />
        </div>

        <ol className="grid gap-2 sm:grid-cols-5">
          {PIPELINE_STAGES.map((s, i) => {
            const done = i < active;
            const current = i === active;
            return (
              <li
                key={s.key}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors sm:flex-col sm:items-start sm:gap-1",
                  current && "bg-primary/10",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]",
                    done && "bg-[#238636]/20 text-accent",
                    current && "bg-primary/20 text-primary",
                    !done && !current && "bg-input text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : current ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    "leading-tight",
                    done ? "text-foreground/70" : current ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function ResultSkeletons() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="overflow-hidden" style={{ animationDelay: `${i * 80}ms` }}>
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="shimmer h-5 w-1/2 rounded bg-input" />
                <div className="shimmer h-3.5 w-4/5 rounded bg-input" />
                <div className="flex gap-2">
                  <div className="shimmer h-5 w-16 rounded bg-input" />
                  <div className="shimmer h-5 w-14 rounded bg-input" />
                  <div className="shimmer h-5 w-20 rounded bg-input" />
                </div>
              </div>
              <div className="flex gap-2">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="shimmer h-12 w-16 rounded-md bg-input" />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CompareTable({ results, onClear }: { results: UiResult[]; onClear: () => void }) {
  const rows: { label: string; get: (r: UiResult) => string; color?: (r: UiResult) => string }[] = [
    { label: "Fit", get: (r) => pct(r.scores.fit), color: (r) => scoreColor(r.scores.fit) },
    { label: "Future", get: (r) => pct(r.scores.future), color: (r) => scoreColor(r.scores.future) },
    { label: "Underrated", get: (r) => pct(r.scores.underrated), color: (r) => scoreColor(r.scores.underrated) },
    { label: "Total", get: (r) => pct(r.scores.total), color: (r) => scoreColor(r.scores.total) },
    { label: "Stars", get: (r) => `${r.metrics?.stars ?? "—"}` },
    { label: "Language", get: (r) => r.repo.language ?? "—" },
    { label: "License", get: (r) => r.repo.license ?? "—" },
    { label: "Type", get: (r) => r.analysis?.repoType ?? "—" },
  ];
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto max-w-7xl overflow-x-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Comparing {results.length} repositories</h3>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left text-muted-foreground"></th>
              {results.map((r) => (
                <th key={r.repo.fullName} className="p-2 text-left font-medium">{r.repo.fullName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="p-2 text-muted-foreground">{row.label}</td>
                {results.map((r) => (
                  <td key={r.repo.fullName} className="p-2">
                    <span className={cn("rounded px-1.5 py-0.5", row.color?.(r))}>{row.get(r)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
