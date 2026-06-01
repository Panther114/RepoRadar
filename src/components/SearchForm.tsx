"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { startSearch, warmSearchRoute } from "@/lib/api/client";
import type { SearchFiltersInput } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Maintained TypeScript library for a local-first Notion-like editor with markdown",
  "Lightweight open-source alternative to Firebase Auth for Next.js",
  "Actively maintained repo implementing RAG over PDFs with local models",
  "Small but promising projects for agentic coding workflows",
  "Backend framework similar to FastAPI but works better with Bun",
];

const LICENSES = [
  { id: "MIT", label: "MIT" },
  { id: "Apache-2.0", label: "Apache" },
  { id: "GPL-3.0", label: "GPL-3" },
  { id: "AGPL-3.0", label: "AGPL-3" },
  { id: "LGPL-2.1", label: "LGPL" },
  { id: "MPL-2.0", label: "MPL-2" },
  { id: "BSD-3-Clause", label: "BSD-3" },
  { id: "ISC", label: "ISC" },
  { id: "Unlicense", label: "Unlicense" },
];

const PROJECT_TYPES = [
  { value: "any", label: "Any type" },
  { value: "library", label: "Library" },
  { value: "framework", label: "Framework" },
  { value: "cli", label: "CLI tool" },
  { value: "app", label: "App" },
  { value: "plugin", label: "Plugin" },
  { value: "extension", label: "Extension" },
  { value: "template", label: "Template" },
];

const RECENCY = [
  { label: "Any time", value: "" },
  { label: "Past month", value: "30" },
  { label: "Past 3 months", value: "90" },
  { label: "Past 6 months", value: "180" },
  { label: "Past year", value: "365" },
];

const MIN_STARS = [
  { label: "Any", value: "" },
  { label: "10+", value: "10" },
  { label: "100+", value: "100" },
  { label: "500+", value: "500" },
  { label: "1k+", value: "1000" },
  { label: "5k+", value: "5000" },
  { label: "10k+", value: "10000" },
];

function activeFilterCount(
  language: string,
  licenses: string[],
  projectType: string,
  recency: string,
  minStars: string,
  includeSmall: boolean,
): number {
  let n = 0;
  if (language) n++;
  if (licenses.length) n++;
  if (projectType && projectType !== "any") n++;
  if (recency) n++;
  if (minStars) n++;
  if (!includeSmall) n++;
  return n;
}

export function SearchForm() {
  const [prompt, setPrompt] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugStatus, setDebugStatus] = useState<string | null>(null);

  const [language, setLanguage] = useState("");
  const [licenses, setLicenses] = useState<string[]>([]);
  const [includeSmall, setIncludeSmall] = useState(true);
  const [projectType, setProjectType] = useState("any");
  const [recency, setRecency] = useState("");
  const [minStars, setMinStars] = useState("");

  const numActive = activeFilterCount(language, licenses, projectType, recency, minStars, includeSmall);

  useEffect(() => {
    void warmSearchRoute();
  }, []);

  async function submit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 3 || submitting) return;
    setSubmitting(true);
    setError(null);
    setDebugStatus("Creating search job...");
    const filters: SearchFiltersInput = {
      language: language || null,
      license: licenses,
      includeSmallProjects: includeSmall,
      projectType,
      pushedWithinDays: recency ? Number(recency) : null,
      minStars: minStars ? Number(minStars) : null,
    };
    try {
      const { searchId, requestId } = await startSearch(trimmedPrompt, filters);
      const nextUrl = `/results/${searchId}`;
      setDebugStatus(
        `Search queued${requestId ? ` (${requestId.slice(0, 8)})` : ""}. Opening results...`,
      );
      console.info("[RepoRadar] Navigating to search results", {
        searchId,
        requestId,
        nextUrl,
      });
      window.location.assign(nextUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setDebugStatus("Search request failed. See the message below and server logs.");
      setSubmitting(false);
    }
  }

  function toggleLicense(l: string) {
    setLicenses((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  }

  function resetFilters() {
    setLanguage("");
    setLicenses([]);
    setIncludeSmall(true);
    setProjectType("any");
    setRecency("");
    setMinStars("");
  }

  return (
    <form className="w-full" onSubmit={submit}>
      {/* Search box */}
      <div className="relative overflow-hidden rounded-md border border-border bg-input transition-colors focus-within:border-primary/70 focus-within:ring-1 focus-within:ring-primary/30">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          rows={2}
          placeholder="Describe the repository you need… e.g. 'a maintained TypeScript markdown editor with real-time collaboration'"
          className="min-h-[56px] resize-none border-0 bg-transparent px-3 pt-3 text-sm leading-6 focus:outline-none focus:ring-0"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={submitting || prompt.trim().length < 3}
              size="sm"
              className="gap-1.5"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {submitting ? "Searching…" : "Search"}
            </Button>
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                showFilters
                  ? "bg-[#21262d] text-foreground"
                  : "text-muted-foreground hover:bg-[#21262d] hover:text-foreground",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {numActive > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-[#010409]">
                  {numActive}
                </span>
              )}
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", showFilters && "rotate-180")}
              />
            </button>
            {numActive > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-[#21262d] hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">Ctrl Enter</span>
        </div>
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-[#f85149]">
          {error}
        </p>
      )}

      {debugStatus && (
        <div
          data-testid="search-debug"
          className="mt-2 rounded-md border border-border bg-input px-2.5 py-2 text-xs text-muted-foreground"
        >
          {debugStatus}
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className="mt-2 overflow-hidden rounded-md border border-border bg-card">
          {/* Row 1: Language + Project type + Active within */}
          <div className="grid gap-3 border-b border-border p-3 sm:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Language
              </span>
              <Input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="TypeScript, Python, Rust…"
                className="h-8 text-sm"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Project type
              </span>
              <select
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-sm"
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Active within
              </span>
              <select
                value={recency}
                onChange={(e) => setRecency(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-sm"
              >
                {RECENCY.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Row 2: Min stars + Include small */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Star className="h-3.5 w-3.5 shrink-0 text-[#d29922]" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Min stars
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {MIN_STARS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setMinStars(s.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    minStars === s.value
                      ? "border-[#d29922]/60 bg-[#d29922]/10 text-[#d29922]"
                      : "border-border bg-input text-muted-foreground hover:border-muted hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeSmall}
                onChange={(e) => setIncludeSmall(e.target.checked)}
                className="accent-primary"
              />
              Include hidden gems
            </label>
          </div>

          {/* Row 3: Licenses */}
          <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              License
            </span>
            <div className="flex flex-wrap gap-1.5">
              {LICENSES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleLicense(l.id)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    licenses.includes(l.id)
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-input text-muted-foreground hover:border-muted hover:text-foreground",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Example prompts */}
      <div className="mt-2.5">
        <p className="mb-1.5 text-xs text-muted-foreground">Example searches</p>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.slice(0, 4).map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="max-w-full truncate rounded-md border border-border bg-input px-2 py-1 text-left text-xs text-muted-foreground hover:border-muted hover:text-foreground"
              title={ex}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
