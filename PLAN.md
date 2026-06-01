# RepoRadar — Implementation Plan

## Context

RepoRadar is a semantic GitHub repository discovery + evaluation engine (full spec in
`REPORADAR.md`). A user describes the kind of repo they want in natural language; RepoRadar
searches GitHub, **deterministically narrows** the candidate pool to a small set, enriches those
with metadata/README/manifests/releases/issues, and then has an **LLM produce** transparent
**Fit / Future / Underrated** scores plus grounded explanations — returning an explainable ranked
list with charts.

This file documents the plan. Stages 1–3 are **implemented**; Stage 4 (deployment) is documented
here and scaffolded (Dockerfile + docker-compose) but not executed. See `PROGRESS.md` for status
and `setup.txt` for how to run it locally.

### Decisions

| Area | Decision |
|------|----------|
| Stack | **Next.js full-stack** (App Router + TypeScript + Tailwind v4 + API routes + Prisma + pgvector). |
| Embeddings | **Local, free, no API key**: Transformers.js (`@xenova/transformers`, `Xenova/all-MiniLM-L6-v2`, 384-dim). Used only in the narrowing funnel. |
| LLM | **DeepSeek via OpenRouter**, slug in env (`OPENROUTER_MODEL`, default `deepseek/deepseek-chat`), strict JSON output. |
| **Scoring ownership** | **The LLM produces the Fit/Future/Underrated scores.** Deterministic code does NOT compute the final scores — it only narrows candidates to ~10–20 repos (`FUNNEL_TOP_N`) to bound LLM cost. *(Deliberate deviation from spec §14 Principle 1, per request.)* |
| Local DB | **Docker Compose** with `pgvector/pgvector:pg16`. |
| Cost / payments | Embeddings are local/free. Only OpenRouter costs money (card/crypto top-up — not WeChat/Alipay). `NO_LLM_MODE=true` runs the whole app with zero paid services (funnel-only ordering). |

### Architecture funnel

```
prompt
  → [LLM or heuristic] intent + constraints + query expansion
  → [GitHub] search variants → dedupe → candidate pool (≈50–120)
  → [DETERMINISTIC FUNNEL] hard filters + local-embedding similarity + cheap signals
        ↓ narrows to ~10–20 survivors          ← deterministic's ONLY job
  → [GitHub] deep enrichment of survivors (README, manifests, releases, issues, contributors)
  → [LLM SCORING] produces Fit / Future / Underrated + component breakdown + evidence  ← AI owns the scores
  → ranked, explainable results + charts
```

To preserve transparency, the spec's formula weights (`src/lib/scoring/rubric.ts`) are passed to
the LLM as a **rubric**; it returns per-component sub-scores + evidence, so the UI shows an
explainable breakdown. In `NO_LLM_MODE` the same Analysis shape is produced by the deterministic
scorer (`src/lib/scoring/deterministic.ts`).

## Project structure (implemented)

```
docker-compose.yml          pgvector Postgres for local dev
Dockerfile / .dockerignore  Next.js standalone image (Stage 4)
.env.example                documented env vars
prisma/schema.prisma        repos, snapshots, readmes, embeddings, queries, results, analyses, jobs
prisma/migrations/0_init    tables + pgvector extension + ivfflat index
src/lib/env.ts              zod-validated config
src/lib/db.ts               Prisma singleton
src/lib/github/             Octokit client, search variants, enrichment
src/lib/llm/                OpenRouter client, intent extraction, AI scoring, JSON helper
src/lib/embeddings/         Transformers.js embedder + pgvector store helpers
src/lib/funnel/narrow.ts    deterministic narrowing → top N
src/lib/scoring/            rubric weights + deterministic fallback scorer
src/lib/pipeline/           runSearch orchestrator + persistence
src/app/api/                search, search/[id], repo/[owner]/[name], .../trends, compare, health
src/app/                    search page, results page, repo detail page
src/components/             RepoCard, ScoreBadge, ScoreBreakdown, charts, SearchForm, ResultsView, RepoDetailView, ui/*
```

## Stage 1 — Architecture & Scaffolding *(done)*
Next.js + Tailwind scaffold; Prisma schema mapping spec §9 + a `search_jobs` table; pgvector via the
`postgresqlExtensions` preview; `0_init` migration with the `vector` extension and an ivfflat cosine
index; clients for DB / GitHub / OpenRouter / local embedder; zod env config; `/api/health`.

## Stage 2 — Core Search + AI Rating *(done)*
Query intent + expansion (LLM with heuristic fallback); GitHub candidate search variants + dedupe;
deterministic funnel (filters + local-embedding similarity → top `FUNNEL_TOP_N`); enrichment of
survivors; **AI scoring** producing Fit/Future/Underrated + components + matched/missing features +
risks + summary; analysis cache keyed by (fullName, pushed_at, README hash, intent hash, model);
background job orchestration; API routes per spec §10; `NO_LLM_MODE` deterministic path.
`POST /api/search` keeps the request path lightweight: it creates the search/job rows, returns the
`searchId`, and then lazily imports the heavy pipeline in the in-process background task. This keeps
the UI responsive during first dev-server compilation and surfaces launch failures as failed jobs
instead of leaving the browser stuck on an indefinite loading state.

## Stage 3 — Frontend Visualization + UI/UX *(done)*
Search page (prompt, filters, examples, ⌘/Ctrl+Enter); results page (TanStack Query polling, progress
bar, ranked `RepoCard`s, score badges + expandable breakdown popover, "Underrated Matches", "Best of"
rails, compare table); repo detail page (summary, matched/missing, risks, breakdown, README evidence,
Recharts fit/future radars + star/fork snapshot trend + release info).

## Stage 4 — Deployment *(documented, not executed)*
`Dockerfile` builds a standalone Next.js image; Railway = Web service + Postgres (enable `vector`) +
optional enrichment worker; `prisma migrate deploy` on release; env vars in the dashboard; health
check `/api/health`. Full local run steps in `setup.txt`.

## Environment variables
See `.env.example`. Key ones: `DATABASE_URL`, `GITHUB_TOKEN` (PAT, read-only public),
`OPENROUTER_API_KEY` (the LLM key), `OPENROUTER_MODEL`, `NO_LLM_MODE`, `FUNNEL_TOP_N`. Embeddings
need no key.

## Verification
1. `docker compose up -d` → `pnpm db:deploy` → `/api/health` shows `pgvector: true`.
2. `NO_LLM_MODE=true pnpm dev` → run an example query → funnel-ordered results, no paid calls.
3. Set `OPENROUTER_API_KEY` + `NO_LLM_MODE=false` → top ~15 get AI scores + grounded explanations.
4. Re-run the same query → cache hits (no new `model_analyses` for unchanged repos).

> Environment note: this repo currently lives on an **exFAT** drive, which has no symlink support.
> That required pnpm `nodeLinker: hoisted`, the webpack builder (Turbopack needs junction points),
> and disabling webpack's filesystem cache. `pnpm dev` works fully; a full `next build` is best run
> on a normal filesystem (Railway/Linux, NTFS, or WSL). See `PROGRESS.md`.
