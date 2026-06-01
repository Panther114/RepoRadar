"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  GitFork,
  GitMerge,
  GitPullRequest,
  Star,
  Tag,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreBadge, scoreColor, pct } from "@/components/ScoreBadge";
import { cn } from "@/lib/utils";
import { formatNumber, ownerNameFromFullName, timeAgo } from "@/lib/format";
import type { UiResult, UiDocs } from "@/lib/api/types";

const severityColor: Record<string, string> = {
  high: "text-[#f85149] border-[#f85149]/40 bg-[#f85149]/10",
  medium: "text-[#d29922] border-[#d29922]/40 bg-[#d29922]/10",
  low: "text-muted-foreground border-border",
};

type Tab = "overview" | "activity" | "breakdown" | "ai";

// -- Score bar --------------------------------------------------------------
function ScoreBar({ label, value, max = 1 }: { label: string; value: number; max?: number }) {
  const pctNum = Math.round((value / max) * 100);
  const color =
    pctNum >= 75 ? "bg-accent" : pctNum >= 50 ? "bg-primary" : pctNum >= 30 ? "bg-[#d29922]" : "bg-[#f85149]";
  return (
    <div className="group flex items-center gap-2">
      <span className="w-36 shrink-0 truncate text-xs text-muted-foreground" title={label}>
        {label.replace(/_/g, " ")}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-input">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${pctNum}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{pctNum}</span>
    </div>
  );
}

// -- Metric chip ------------------------------------------------------------
function Chip({
  icon: Icon,
  label,
  value,
  title,
  highlight,
}: {
  icon: React.ElementType;
  label?: string;
  value: React.ReactNode;
  title?: string;
  highlight?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-input px-1.5 py-0.5 text-[11px]",
        highlight ? "text-accent" : "text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label && <span className="text-[11px] opacity-60">{label}</span>}
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}

// -- Docs signal row --------------------------------------------------------
function DocsBadge({ has, label }: { has: boolean; label: string }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium",
        has
          ? "border-[#2ea043]/40 bg-[#238636]/10 text-accent"
          : "border-border text-muted-foreground/40 line-through",
      )}
    >
      {label}
    </span>
  );
}

// -- Main card -------------------------------------------------------------
export function RepoCard({
  result,
  selected,
  onToggleSelect,
  defaultTab,
  maxStars,
}: {
  result: UiResult;
  selected?: boolean;
  onToggleSelect?: (fullName: string) => void;
  defaultTab?: Tab;
  /** Largest star count in the current result set — drives the relative star bar. */
  maxStars?: number;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(defaultTab ?? "breakdown");
  const { repo, scores, analysis, metrics } = result;
  const docs = result.docs as UiDocs | null;
  const similarity = result.similarity as number | null;
  const [owner, name] = ownerNameFromFullName(repo.fullName);

  // -- PR / issue health ratio ----------------------------------------------
  const totalIssues = (metrics?.openIssues ?? 0) + (metrics?.closedIssues ?? 0);
  const issueCloseRate = totalIssues > 0 ? (metrics?.closedIssues ?? 0) / totalIssues : null;
  const totalPRs = (metrics?.openPRs ?? 0) + (metrics?.mergedPRs ?? 0);
  const prMergeRate = totalPRs > 0 ? (metrics?.mergedPRs ?? 0) / totalPRs : null;
  const isHealthy = (issueCloseRate ?? 0) > 0.7 && (prMergeRate ?? 0) > 0.6;

  const topics = (repo.topics ?? []).slice(0, 5);

  // Relative star magnitude within the result set (log scale reads better across
  // the long tail of star counts).
  const starRatio =
    maxStars && maxStars > 0 && metrics?.stars
      ? Math.log10(metrics.stars + 1) / Math.log10(maxStars + 1)
      : null;

  return (
    <Card
      className={cn(
        "card-hover animate-in overflow-hidden",
        selected && "border-primary/50 ring-1 ring-primary/30",
      )}
    >
      <CardContent className="p-0">
        {/* -- Header -------------------------------------------------------- */}
        <div className="grid gap-3 p-3 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0 flex-1">
            {/* title row */}
            <div className="flex items-center gap-2">
              {result.rank != null && (
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                  #{result.rank}
                </span>
              )}
              <Link
                href={`/repo/${owner}/${name}`}
                className="truncate text-sm font-semibold text-foreground hover:text-primary"
              >
                <span className="text-muted-foreground">{owner}/</span>
                <span>{name}</span>
              </Link>
              <a
                href={repo.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-muted-foreground/50 hover:text-primary"
                aria-label="Open on GitHub"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {analysis?.source === "deterministic" && (
                <Badge className="border-[#d29922]/40 bg-[#d29922]/10 text-[#d29922]">heuristic</Badge>
              )}
              {isHealthy && (
                <Badge className="border-[#2ea043]/40 bg-[#238636]/10 text-accent">
                  <Zap className="mr-1 h-3 w-3" /> healthy
                </Badge>
              )}
            </div>

            {/* description */}
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {repo.description ?? "No description."}
            </p>

            {/* badges row */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {repo.language && <Badge>{repo.language}</Badge>}
              {repo.license && <Badge>{repo.license}</Badge>}
              {analysis?.repoType && analysis.repoType !== "any" && (
                <Badge>{analysis.repoType}</Badge>
              )}
              {topics.map((t) => (
                <Badge key={t} className="border-border/60 text-muted-foreground/70">
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          {/* scores */}
          <div className="flex flex-col gap-1.5 sm:items-end">
            <div className="flex flex-wrap items-center gap-1">
              <ScoreBadge label="Fit" value={scores.fit} />
              <ScoreBadge label="Future" value={scores.future} />
              <ScoreBadge label="Under" value={scores.underrated} title="Underrated potential" />
              <ScoreBadge label="Total" value={scores.total} size="lg" />
            </div>
            {similarity != null && (
              <span className="text-[11px] text-muted-foreground">
                {Math.round(similarity * 100)}% semantic match
              </span>
            )}
          </div>
        </div>

        {/* -- Metrics strip ------------------------------------------------ */}
        <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
          <Chip icon={Star} value={formatNumber(metrics?.stars)} title="Stars" highlight={(metrics?.stars ?? 0) > 1000} />
          <Chip icon={GitFork} value={formatNumber(metrics?.forks)} title="Forks" />
          {metrics?.contributors != null && metrics.contributors > 0 && (
            <Chip icon={Users} value={metrics.contributors} label="contrib" title="Contributors" />
          )}
          {metrics?.releaseCount != null && (
            <Chip icon={Tag} value={metrics.releaseCount} label="releases" title={`Latest: ${metrics.latestReleaseAt ? timeAgo(metrics.latestReleaseAt) : "unknown"}`} />
          )}
          {metrics?.releasesLast90 != null && metrics.releasesLast90 > 0 && (
            <Chip icon={Zap} value={`${metrics.releasesLast90} / 90d`} label="" title="Releases in last 90 days" highlight />
          )}
          {issueCloseRate != null && (
            <Chip
              icon={GitPullRequest}
              value={`${Math.round(issueCloseRate * 100)}%`}
              label="issue close"
              title={`${metrics?.closedIssues ?? 0} closed / ${totalIssues} total`}
              highlight={issueCloseRate > 0.7}
            />
          )}
          {prMergeRate != null && (
            <Chip
              icon={GitMerge}
              value={`${Math.round(prMergeRate * 100)}%`}
              label="PR merge"
              title={`${metrics?.mergedPRs ?? 0} merged / ${totalPRs} total`}
              highlight={prMergeRate > 0.6}
            />
          )}
          <span className="ml-auto self-center text-[11px] text-muted-foreground">
            pushed {timeAgo(metrics?.pushedAt)}
          </span>
        </div>

        {/* -- Relative star magnitude (within this result set) -------------- */}
        {starRatio != null && (
          <div
            className="flex items-center gap-2 px-3 pb-1 pt-0.5"
            title="Star magnitude relative to this result set (log scale)"
          >
            <Star className="h-3 w-3 shrink-0 text-[#d29922]" />
            <div className="h-1 max-w-[180px] flex-1 overflow-hidden rounded-full bg-input">
              <div
                className="h-full rounded-full bg-[#d29922]"
                style={{
                  width: `${Math.round(starRatio * 100)}%`,
                  transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)",
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground/70">
              {formatNumber(metrics?.stars)}★
            </span>
          </div>
        )}

        {/* -- AI summary --------------------------------------------------- */}
        {analysis?.summary && (
          <div className="border-t border-border px-3 py-2">
            <p className="text-xs leading-5 text-foreground/90">{analysis.summary}</p>
          </div>
        )}

        {/* -- Risks -------------------------------------------------------- */}
        {!!analysis?.risks?.length && (
          <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
            {analysis.risks.slice(0, 4).map((r, i) => (
              <Badge key={i} className={cn(severityColor[r.severity] ?? "")} title={r.evidence}>
                risk: {r.risk}
              </Badge>
            ))}
          </div>
        )}

        {/* -- Expand controls ---------------------------------------------- */}
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} className="gap-1.5 text-xs">
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")}
            />
            {open ? "Less" : "Details"}
          </Button>
          <div className="flex items-center gap-3">
            {onToggleSelect && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!!selected}
                  onChange={() => onToggleSelect(repo.fullName)}
                  className="accent-primary"
                />
                Compare
              </label>
            )}
          </div>
        </div>

        {/* -- Expanded detail panel ---------------------------------------- */}
        {open && analysis && (
          <div className="border-t border-border/60">
            {/* tabs */}
            <div className="flex gap-0 border-b border-border">
              {(["breakdown", "activity", "ai"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-3 py-2 text-xs font-medium transition-colors",
                    tab === t
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "breakdown" ? "Score Breakdown" : t === "activity" ? "Activity" : "AI Analysis"}
                </button>
              ))}
            </div>

            <div className="p-3">
              {/* -- Tab: Score Breakdown ----------------------------------- */}
              {tab === "breakdown" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">
                      Fit breakdown{" "}
                      <span className={cn("ml-1 rounded px-1.5 py-0.5 text-sm font-bold", scoreColor(scores.fit))}>
                        {pct(scores.fit)}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {Object.entries(analysis.fitComponents ?? {}).map(([k, v]) => (
                        <ScoreBar key={k} label={k} value={v} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">
                      Future breakdown{" "}
                      <span className={cn("ml-1 rounded px-1.5 py-0.5 text-sm font-bold", scoreColor(scores.future))}>
                        {pct(scores.future)}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {Object.entries(analysis.futureComponents ?? {}).map(([k, v]) => (
                        <ScoreBar key={k} label={k} value={v} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* -- Tab: Activity ------------------------------------------ */}
              {tab === "activity" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MetricBox label="Stars" value={formatNumber(metrics?.stars)} icon={Star} />
                    <MetricBox label="Forks" value={formatNumber(metrics?.forks)} icon={GitFork} />
                    <MetricBox label="Contributors" value={metrics?.contributors ?? "—"} icon={Users} />
                    <MetricBox label="Total releases" value={metrics?.releaseCount ?? "—"} icon={Tag} />
                    <MetricBox label="Releases (90d)" value={metrics?.releasesLast90 ?? "—"} icon={Zap} />
                    <MetricBox label="Open issues" value={formatNumber(metrics?.openIssues)} icon={GitPullRequest} />
                    <MetricBox label="Closed issues" value={formatNumber(metrics?.closedIssues)} icon={GitPullRequest} />
                    <MetricBox label="Merged PRs" value={formatNumber(metrics?.mergedPRs)} icon={GitMerge} />
                  </div>
                  {docs && (
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">
                        Documentation signals
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <DocsBadge has={!!docs.hasInstall} label="Install guide" />
                        <DocsBadge has={!!docs.hasQuickstart} label="Quickstart" />
                        <DocsBadge has={!!docs.hasExamples} label="Examples" />
                        <DocsBadge has={!!docs.hasApiDocs} label="API docs" />
                        <DocsBadge has={!!docs.hasDocsFolder} label="Docs folder" />
                        <DocsBadge has={!!docs.hasWebsite} label="Website" />
                        {docs.readmeLength != null && (
                          <span className="self-center text-xs text-muted-foreground">
                            README: {(docs.readmeLength / 1000).toFixed(1)}k chars
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* -- Tab: AI Analysis --------------------------------------- */}
              {tab === "ai" && (
                <div className="space-y-4">
                  {analysis.matchedFeatures && analysis.matchedFeatures.length > 0 && (
                    <FeatureList
                      title="Matched features"
                      tone="emerald"
                      items={analysis.matchedFeatures.map((f) => ({
                        head: f.feature,
                        body: f.evidence,
                        confidence: f.confidence,
                      }))}
                    />
                  )}
                  {analysis.missingFeatures && analysis.missingFeatures.length > 0 && (
                    <FeatureList
                      title="Missing or unclear"
                      tone="rose"
                      items={analysis.missingFeatures.map((f) => ({
                        head: f.feature,
                        body: f.reason,
                        confidence: f.confidence,
                      }))}
                    />
                  )}
                  {analysis.risks && analysis.risks.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">
                        Risk factors
                      </div>
                      <div className="space-y-2">
                        {analysis.risks.map((r, i) => (
                          <div
                            key={i}
                            className={cn(
                              "rounded-md border px-3 py-2 text-xs",
                              severityColor[r.severity] ?? "border-border text-muted-foreground",
                            )}
                          >
                            <span className="font-semibold">{r.risk}</span>
                            {r.evidence && (
                              <span className="ml-2 opacity-70">— {r.evidence}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Link
                      href={`/repo/${owner}/${name}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-input/50 px-3 py-1.5 text-xs hover:border-primary/40 hover:text-primary"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      Full analysis →
                    </Link>
                    {analysis.source === "ai" && (
                      <span className="text-xs text-muted-foreground">Scored by AI</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -- Helper sub-components -------------------------------------------------

function MetricBox({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-input px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function FeatureList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "emerald" | "rose";
  items: { head: string; body: string; confidence?: number }[];
}) {
  if (!items.length) return null;
  const dot = tone === "emerald" ? "bg-accent" : "bg-[#f85149]";
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
            <span>
              <span className="font-medium text-foreground">{it.head}</span>
              {it.confidence != null && (
                <span className={cn("ml-1 text-[10px] opacity-60")}>
                  ({Math.round(it.confidence * 100)}%)
                </span>
              )}
              <span className="text-muted-foreground"> — {it.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
