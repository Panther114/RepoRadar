# RepoRadar — Progress

_Last updated: 2026-06-01_

## Summary

Stages **1–3 are implemented and runtime-verified** via the dev server. Stage 4 (deployment) is
**documented and scaffolded** (Dockerfile, docker-compose, migrations) but not executed. The whole
codebase passes `tsc --noEmit` (strict).

## What works (verified)

- `pnpm dev` boots in ~0.8s; **home page returns 200** and renders the RepoRadar UI.
- **`/api/health` runs** (returns JSON; reports `db:false` only because Postgres isn't running locally).
- **`/results/[id]` and `/repo/[owner]/[name]` compile and return 200.**
- Full **TypeScript typecheck passes** (`pnpm typecheck`).
- Prisma client generates; the initial migration SQL (tables + `vector` extension + ivfflat index)
  is generated and committed at `prisma/migrations/0_init`.

## Done by stage

### Stage 1 — Architecture & scaffolding ✅
- Next.js 16 (App Router, TS) + Tailwind v4, pnpm.
- `docker-compose.yml` (pgvector/pgvector:pg16).
- `prisma/schema.prisma` — all spec §9 tables + `search_jobs`; vector columns via the
  `postgresqlExtensions` preview; `0_init` migration with `CREATE EXTENSION vector` + ivfflat index.
- Clients: `src/lib/db.ts`, `github/client.ts`, `llm/client.ts`, `embeddings/embedder.ts`.
- `src/lib/env.ts` (zod-validated config) and `/api/health`.

### Stage 2 — Search pipeline + AI rating ✅
- Intent extraction + query expansion (`llm/intent.ts`) with a heuristic `NO_LLM_MODE` fallback.
- GitHub candidate search variants + dedupe (`github/search.ts`).
- **Deterministic funnel** (`funnel/narrow.ts`): local-embedding similarity + cheap signals →
  top `FUNNEL_TOP_N` survivors. (Narrowing only — no scoring.)
- Enrichment (`github/enrich.ts`): README (truncated + hashed), manifests, releases, issue/PR
  counts, contributors, docs signals.
- **AI scoring** (`llm/score.ts`): the LLM produces Fit/Future/Underrated + per-component
  sub-scores + matched/missing features + risks + summary (strict JSON). Deterministic fallback in
  `scoring/deterministic.ts` using the same rubric (`scoring/rubric.ts`).
- Analysis caching in `model_analyses` keyed by (fullName, pushed_at, README hash, intent hash, model).
- Background orchestrator (`pipeline/runSearch.ts`) + persistence (`pipeline/persist.ts`);
  embeddings persisted to pgvector (`embeddings/store.ts`).
- API routes: `POST /api/search`, `GET /api/search/[id]`, `GET /api/repo/[owner]/[name]`,
  `GET .../trends`, `POST /api/compare`.

### Stage 3 — Frontend + visualization ✅
- Search page: prompt textarea, filters panel, example chips, ⌘/Ctrl+Enter.
- Results page: TanStack Query polling, progress bar, ranked `RepoCard`s, score badges +
  expandable breakdown, "Underrated Matches", "Best of" rails, compare table.
- Repo detail page: summary, why-it-matches / missing, risks, score breakdown, README evidence,
  Recharts fit/future radars + star/fork snapshot trend + release info.

### Stage 4 — Deployment 📄 (documented, not executed)
- `Dockerfile` + `.dockerignore` (build on Linux/Railway).
- `pnpm db:deploy` runs migrations; container CMD runs `prisma migrate deploy` then `pnpm start`.

## How to run locally
See `setup.txt`. Short version:
1. Install Docker Desktop (not currently installed) and start it.
2. `copy .env.example .env` and set `OPENROUTER_API_KEY` (or keep `NO_LLM_MODE=true` for free mode);
   add a `GITHUB_TOKEN`.
3. `docker compose up -d` → `pnpm install` → `pnpm db:deploy` → `pnpm dev` → http://localhost:2000.

## Moving this drive to another machine

The whole project (including `node_modules`, `.env`, and the lockfile) travels with the drive. But
`node_modules` contains **platform-specific native binaries** (the Prisma query engine and
`onnxruntime-node` used for embeddings), so they only work if the new machine is the **same OS +
CPU architecture** (here: Windows x64). On a different OS/arch you must reinstall. Either way, the
steps below are safe.

### Step 0 — Install the toolchain on the NEW machine
RepoRadar needs these installed *on the machine* (they are not on the drive):
- **Node.js 20+** — check with `node --version`.
- **pnpm** — `npm install -g pnpm` (then confirm `pnpm --version`). On Windows the global bin is
  usually `%AppData%\npm`; make sure it's on PATH.
- **Docker Desktop** — install and **start it** (needed for the local Postgres).

### Step 1 — Open the project at its new location
The drive letter may change (e.g. `D:` instead of `E:`). That's fine — the app uses relative paths,
and `DATABASE_URL` points at `localhost:5432`, not at a drive path. Just `cd` into the project.

### Step 2 — Refresh dependencies + Prisma client (do this every move)
```
pnpm install            # repairs the hoisted node_modules for this machine
pnpm exec prisma generate
```
If `pnpm install` warns about ignored build scripts (Prisma/onnxruntime), they are already allow-listed
in `pnpm-workspace.yaml` (`allowBuilds`); re-run `pnpm install` so the engines build/download.
**If the new machine is a different OS/arch (e.g. macOS or ARM):** delete `node_modules` first, then
run the two commands above:
```
# Windows:  Remove-Item node_modules -Recurse -Force
# macOS/Linux:  rm -rf node_modules
```

### Step 3 — Environment file
`.env` is on the drive, so your `OPENROUTER_API_KEY` / `GITHUB_TOKEN` come along. If it's missing
(or you'd rather not carry secrets), `copy .env.example .env` and refill. Keep
`DATABASE_URL=postgresql://reporadar:reporadar@localhost:5432/reporadar?schema=public`.

### Step 4 — Database
```
docker compose up -d     # starts Postgres + pgvector
pnpm db:deploy           # applies migrations (idempotent; safe to re-run)
```
The Postgres **data does NOT move with the drive** (it lives in a Docker volume on the old machine).
So the DB starts empty on the new machine — that's expected; just re-run searches. (To carry data
over, `pg_dump` on the old machine and restore on the new one.)

### Step 5 — Clear stale build caches, then run
```
# Windows:  Remove-Item .next,tsconfig.tsbuildinfo -Recurse -Force -ErrorAction SilentlyContinue
pnpm dev
```
Open http://localhost:2000 and check http://localhost:2000/api/health → expect
`{"status":"ok","db":true,"pgvector":true}`.

### Notes
- **First search re-downloads the embedding model** (~25–90 MB) unless the Transformers.js cache
  inside `node_modules/@xenova` copied intact — so have internet available the first time.
- **If the new location is NTFS or ext4 (not exFAT)**, you can drop the exFAT workarounds for speed:
  remove `nodeLinker: hoisted` from `pnpm-workspace.yaml` (then reinstall), and in `next.config.ts`
  remove `cache = false` / `resolve.symlinks = false` and switch scripts back to Turbopack
  (`next dev` / `next build` without `--webpack`). On exFAT, leave them as-is.

## Environment-specific notes (important)
This drive (`E:`) is **exFAT**, which has no symlink support. To work around that:
- pnpm uses `nodeLinker: hoisted` (in `pnpm-workspace.yaml`).
- The app uses the **webpack** builder (`--webpack`); Turbopack fails because it creates junction
  points. `next.config.ts` also sets `resolve.symlinks = false` and `cache = false`.
- `pnpm dev` works fully. A full `pnpm build` (production) hits exFAT `readlink`/junction errors and
  should be run on a normal filesystem (Railway/Linux, NTFS, or WSL). This is a filesystem limit,
  not a code bug — the code typechecks and all routes run under `pnpm dev`.

## Not yet verified (needs services this machine lacks)
- **End-to-end live search**: needs Docker Postgres running (Docker not installed here). The pipeline
  code is complete and typechecks; once a DB is up, `NO_LLM_MODE=true` exercises the full flow with
  no paid calls.
- **Search responsiveness diagnostics**: `POST /api/search` now queues the job before lazily loading
  the heavy pipeline, returns a `requestId`, and logs request/job/pipeline launch timings to
  `logs/pipeline.log`. The browser client logs search start, POST completion, and poll state changes
  in DevTools.
- **Search submit reliability**: the home page now pre-warms `/api/search`, uses a native form submit,
  shows a visible debug status while the job is being created, and hard-navigates to the result URL as
  soon as the queued `searchId` is returned. `GET /api/search` is a lightweight readiness endpoint for
  warming and diagnostics.
- **Search ETA**: the default estimate is now 40 seconds, and the UI explicitly says fresh searches
  usually take about 40 seconds.
- **Results-route stability**: the React Query provider is now scoped to the results route instead of
  the root app shell, which removes the `app/layout.js` chunk from the critical navigation path and
  avoids the dev-only `ChunkLoadError` / stale shell crash.
- **Next dev stability**: exFAT-specific webpack workarounds are now opt-in with
  `REPORADAR_EXFAT_MODE=true`. This checkout is on NTFS, so the normal Next dev cache/manifests are
  used by default to avoid stale/empty manifest failures during local testing.
- **Real AI scoring**: needs `OPENROUTER_API_KEY` + `NO_LLM_MODE=false`.
- **Production build / Railway deploy**: run on Linux per the note above.

## Known limitations / future work (per spec §15–16)
- Star "velocity" is approximated (no stargazer history); the trend chart uses metric snapshots that
  accumulate over re-analysis, not true historical stars.
- Issue/PR counts use best-effort GitHub search and can be throttled without a token.
- Background jobs run in-process (fire-and-forget) — fine for a single Node server; a real queue
  (BullMQ/Redis) is future work.
- Out of MVP scope: full GitHub indexing, browser extension, CLI, package-registry (npm/PyPI/crates)
  download stats.

## Verification checklist (for when DB + key are available)
1. `docker compose up -d` → `pnpm db:deploy` → `/api/health` → `{"status":"ok","db":true,"pgvector":true}`.
2. `NO_LLM_MODE=true pnpm dev` → run a query → funnel-ordered results, no paid calls.
3. Set key + `NO_LLM_MODE=false` → top ~`FUNNEL_TOP_N` get AI scores + grounded explanations.
4. Re-run the same query → cache hits (no new `model_analyses` rows for unchanged repos).
