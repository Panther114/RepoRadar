# Changelog

All notable changes to RepoRadar are recorded here.

## v1.1.4

Query-understanding + diverse-sources release. Adds the transition layer between a user's *wording* and
search intent, plus two independent candidate sources beyond GitHub search. On the gold set, measured as a
**frozen-pool A/B** (all features off vs on, same cache window, 2 repeats — the only attribution method that
controls for GitHub pool variance + temp-0 LLM drift): **nDCG@10 0.643 → 0.686 (+0.044), MRR 0.844 → 0.938,
AllRelevant 0.50 → 0.63, junk-rate 0.63 → 0.50 (lower is better), recall flat.** No prompt regressed; the
biggest per-prompt gains were react-data-table (+0.15), self-hosted-analytics (+0.09) and the
firebase-alternative archetype (+0.08). Cost: ≈ +8s p50 latency.

- **On by default** (net win, gated for safety):
  - `REF_RESOLVE` — **reference resolution.** Prompts that define the target by pointing at another project
    ("open source alternative to firebase", "notion-like editor", "stripe clone") carry almost no domain
    vocabulary in their literal words, so keyword/embedding search built from the prompt text systematically
    underperforms. RepoRadar now detects the reference (regex + the LLM intent pass), derives dedicated
    `<x> alternative` / `topic:<x>-alternative` queries that slot in at the top of the variant list, pulls
    the referenced project's own description + topics in as **anchor text** for the intent embedding, and
    **excludes the referenced project itself** from results. The firebase archetype reliably surfaces
    supabase, pocketbase, nhost, trailbase and bknd.
  - `AWESOME_LISTS` — mines the top `awesome-<topic>` lists for the query domain; the repos they link join
    the candidate pool (curated membership is the strongest free relevance prior). Human curation earns a
    repo its *pool slot*; relevance + authority still decide its rank.
  - `REGISTRY_SOURCES` — npm and crates.io search as independent candidate sources (registry rank blends
    popularity, maintenance and text relevance — surfacing repos GitHub's own "best match" buries). Fires
    only for explicitly library-shaped queries.
- **Injection gate (`sourceGate.ts`):** every out-of-band candidate (awesome / registry) must clear
  topicality (≥2 distinct query tokens or a verbatim keyword phrase), traction (≥50★ unless the user asked
  for small/underrated repos) and liveness (pushed within 2 years) before it can enter the pool, and
  displacement of the organically-retrieved pool tail is capped at 10%. Without this the first cut drove the
  junk-rate from 0.17 to 0.75; with it, junk *fell* below the baseline.
- **Canonical-rescue fix in the funnel:** famous canonical hints (≥10k★) now bypass the similarity floor
  (major projects often have marketing-speak descriptions that embed poorly — "Build like a team of
  hundreds" for appwrite on a "firebase alternative" prompt), and the rescue budget counts *forced* rescues
  only, so a query whose obvious answers already rank well still has budget for the one hint the embedding
  missed. If a rescued repo is genuinely off-domain the listwise stage still demotes it. firebase prompt:
  0.64 → 0.83 nDCG at its best.
- **Findings / methodology:** the single most important lesson, reconfirmed: search A/B is dominated by
  GitHub pool variance, so a candidate must be compared against a control run *in the same cache window* —
  an earlier draft showed a phantom −0.40 on react-data-table purely because the control pool was 3 hours
  stale. Awesome-list mining is sound for real single searches but gets rate-limited to zero during
  back-to-back eval runs; registry search adds cross-framework noise on multi-framework domains that the
  gate + cross-encoder absorb in aggregate. New unit tests cover the reference-detection layer (16 total).

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
