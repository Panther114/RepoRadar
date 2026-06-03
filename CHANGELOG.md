# Changelog

All notable changes to RepoRadar are recorded here.

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
