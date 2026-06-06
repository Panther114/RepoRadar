# Changelog

All notable changes to RepoRadar are recorded here.

## v1.1.3

Search-quality release. Adds a rigorous evaluation harness, two relevance/recall features on by default,
and an opt-in toolbox. On the gold set vs v1.1.2: **nDCG@10 0.665 → 0.709, Recall@15 0.557 → 0.621,
trap-leak 0.31 → 0.13 (halved), latency p50 −10s.**

- **On by default** (net win, A/B-measured):
  - `SEARCH_SORT_VARIANTS` — re-issue the 2 strongest queries under `sort:stars`/`sort:updated`,
    RRF-fused. Reliably pulls canonical high-star repos into the pool (surfaced `rwf2/Rocket` and
    kubernetes tools keyword search missed; kubernetes pool recall 0.71 → 1.00).
  - `CROSS_ENCODER_RERANK` — a local `ms-marco-MiniLM` cross-encoder reranks the funnel shortlist for
    sharper (query, repo) relevance. Paired with a **non-saturating prominence co-signal** so it cannot
    bury a canonical 31k-star project under a keyword-perfect demo (turned an early vector-db regression
    into a +0.14 win there). Downloads a ~90 MB model once; set `CROSS_ENCODER_RERANK=false` to skip.
- **Evaluation harness (`scripts/eval/`):** a labeled gold set across 8 field-diverse prompts plus a
  runner/metrics/report scoring nDCG@10, Recall@15, pool recall, MRR, trap-leak, junk rate, and latency
  with run-to-run variance. The referee for any future search change.
- **Opt-in / experimental** (default off, documented in `.env.example`): `HYDE`, `GITHUB_PER_PAGE`, and
  the measured net-negative `HYBRID_FUNNEL`, `GRAPH_TOPICS`, `MMR_DIVERSIFY` (kept in code for tuning).
- **Findings (see `PLAN.md`):** breadth and precision trade off on this corpus; cross-encoders reward
  surface text and need an authority co-signal (the prominence fix); BM25 fusion backfires on
  "awesome/benchmark/comparison" meta-repos; and search A/B is dominated by GitHub pool variance +
  temp-0 LLM query drift, so reliable attribution needs frozen pools and ≥3 repeats.

## v1.1.2

- Search relevance overhaul focused on making all 15 results genuinely the best matches:
  - **Reliable listwise ranking.** The single listwise rerank pass was silently truncating its
    JSON output (token budget too small for 15 fully-detailed repos), so it failed on every
    observed query and ranking collapsed to a noisy deterministic fallback. The output schema is
    now compact (rank, fit, relevance verdict, type, short summary) with ample token headroom and a
    parse retry. Listwise success went from 0% to 100% across the diagnostic prompts — and cost
    dropped, because one reliable call replaces a failed call plus up to ten pointwise fallbacks.
  - **Relevance demotion.** The reranker now flags off-topic / low-quality repos (keyword-only
    matches, personal tutorials, abandoned demos) and they are always ranked below genuine matches.
  - **Credibility floor in the funnel.** A gated popularity/forks term keeps 0-star keyword-stuffed
    repos (e.g. a personal `…-Observability-Stack-…-in-Kubernetes` repo) out of the shortlist while
    preserving real hidden gems with modest traction.
  - **Stricter guidance matching.** A topic hint now requires at least two matching prompt tokens,
    so a generic word like "react" no longer triggers the wrong hint (which had been injecting
    Zustand/Jotai/Redux as canonical rescues into a "react data table" search).
  - **Similarity-gated rescues.** Canonical/guidance repo suggestions are only force-kept when they
    are at least nearly as relevant as the weakest natural survivor, so a loose hint can no longer
    displace a real match.
  - Added `SEARCH_DEBUG=true` tracing (`logs/search-debug.jsonl`) and `scripts/run-search.mjs` for
    local search-quality inspection.

## v1.1.1

- Added persistent top-bar metrics for total unique visitors and total search requests.
- The version badge now advances with the release so the UI and changelog stay aligned.
- Created the reusable `update-version` skill so future release bumps follow one workflow.

## v1.1.0

- Massive search upgrade: intent expansion, deduping, deterministic funneling, and evidence-first
  ranking were tightened so results are more relevant and easier to trust.
- Improved the public-facing story around the product so the repo is easier to evaluate quickly.
- Added more benchmark and diagnostics surface area so search quality is easier to inspect.

## v1.0.0

- Initial commit.
- Baseline RepoRadar application scaffold with search, enrichment, scoring, and deployment support.
- First pass at documentation, local setup, and repository layout.
