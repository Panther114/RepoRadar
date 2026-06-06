# RepoRadar v1.1.3 — Search Quality Overhaul: Execution Plan

> Branch: `v1.1.3-search-overhaul` · Target release: **v1.1.3**
> Status: PLANNING (no feature code yet — this document is the contract for execution)

This plan turns the v1.1.3 research report into an aggressive, complete, **measured** execution.
It is deliberately structured as **measure first → change one thing → re-test → keep or revert**.
Every feature below is a *hypothesis*, not a commitment. We keep only what the numbers justify.

---

## 1. Vision & success criteria

**Mission:** for any natural-language need, the 15 results RepoRadar returns should be *the 15 best
repositories that exist on GitHub for that need* — relevant, high-quality, and broad enough to include
the non-obvious gems that keyword search alone never finds.

We are attacking three independent failure surfaces (the mental model that drives everything):

1. **Breadth / Recall** — the ideal repo never enters the candidate pool. *No ranker can fix this.*
2. **Relevance / Precision** — the ideal repo is in the pool but ranked below noise.
3. **Accuracy / Calibration** — scores and explanations misrepresent fit or quality.

**Release is "done" for v1.1.3 when, on the gold set (§8):**

| Metric | Baseline (v1.1.2, to be measured in Phase 0) | v1.1.3 target |
|---|---|---|
| **Recall@15** (gold relevant repos present in final 15) | TBD | **+≥15% absolute** |
| **nDCG@10** (ranking quality) | TBD | **+≥0.07** |
| **"All-15-relevant" rate** (searches with 0 irrelevant in top 15) | TBD | **≥90%** |
| **Junk rate** (0-star / tutorial / off-topic repos in top 15) | TBD | **≤2%** |
| **Latency p50 / p95** | ~35s / ~60s | **no worse than +15%** |
| **LLM cost / search** | TBD | **no worse than +20%** |

Hard guardrails (a change that violates these is reverted regardless of relevance gain):
- p95 latency **≤ 75s** for a cold search.
- Mean LLM spend **≤ 1.2×** the v1.1.2 baseline.
- The pipeline must still run end-to-end in `NO_LLM_MODE=true` (deterministic path stays intact).

---

## 2. Guiding principles (non-negotiable)

1. **Measurement precedes optimization.** Phase 0 builds the harness. Nothing ships before it.
2. **One variable at a time.** Each phase changes exactly one mechanism so we can attribute the delta.
3. **Keep-only-if-it-helps.** Every feature is gated behind a flag and A/B'd against the harness. If it
   doesn't beat baseline on the primary metric within budget, it is **reverted, not "left in just in case."**
4. **Flexible ordering.** Phases are ordered by expected impact/effort, but the harness reorders reality.
   If Phase 2 underwhelms and Phase 4 surprises, we resequence. This document is updated as we learn.
5. **Cost & latency are first-class.** Users abandon after ~3s of *perceived* wait; our budget is a
   feature, not an afterthought. Local/free compute is preferred over paid calls wherever quality is comparable.
6. **Reproducibility.** Intent is `temperature:0`; the harness runs each prompt **≥2×** and reports
   variance. A "win" must be a win on the *median* of repeats, not a lucky single run.
7. **Everything behind env flags.** Each feature: `FEATURE_X=true|false`, default `false` until proven,
   flipped to `true` once validated, documented in `.env.example`.

---

## 3. The change inventory (what we are going to build)

Grouped by lever, in default execution order. IDs are referenced by the phases in §5.

**Breadth (Recall):**
- `B1` — GitHub search yield: `per_page` 20→100 (5× raw candidates, same API-call cost).
- `B2` — Sort-diversified retrieval: run core queries under `best-match` + `sort:stars` + `sort:updated`.
- `B3` — Graph expansion: topic co-occurrence → dependents (deps.dev/Libraries.io) → co-star CF seeds.
- `B4` — HyDE: LLM writes a hypothetical ideal README per aspect; embed *that* for the funnel.

**Relevance (Precision):**
- `R1` — Hybrid lexical+dense funnel: BM25/field-weighted score fused with embedding score via RRF (k=60).
- `R2` — Embedding model upgrade: `all-MiniLM-L6-v2` → `bge-small-en-v1.5` / `gte-small` / `bge-m3` (local, ONNX).
- `R3` — Local cross-encoder rerank stage: retrieve wide (≈60) → cross-encoder → ≈20 → LLM listwise → 15.
- `R4` — MMR diversification of the final list (category coverage).
- `R5` — Intent typing for "alternative to X" → seed recall from X's topics/dependents/co-stars.

**Accuracy (Calibration & Trust):**
- `A1` — Evaluation harness + labeled gold set (Phase 0; precondition for everything).
- `A2` — Anchor `fit` to retrieval signals (cross-encoder + similarity), LLM owns explanation not raw score.
- `A3` — Feedback logging → learning-to-rank over {sim, bm25, cross-encoder, stars, recency, health}.

**Out-of-the-box (stretch):**
- `X1` — `repo2vec` star-graph index, precomputed offline, fused with text retrieval.
- `X2` — Full-README chunk-level retrieval with max-pool.
- `X3` — Star-velocity / rising-repo signals from GH Archive for Future/Underrated.

---

## 4. Where each change lands (file map)

So execution is unambiguous. (Paths are current as of v1.1.2.)

| Change | Primary files |
|---|---|
| B1, B2 | `src/lib/github/search.ts` (per_page, query/sort variants), `src/lib/llm/intent.ts` (`buildQueries`/`expandQuerySet`) |
| B3, R5 | new `src/lib/search/graphExpand.ts`; `src/lib/github/client.ts`; `src/lib/pipeline/runSearch.ts` |
| B4 (HyDE) | new `src/lib/search/hyde.ts`; `src/lib/funnel/narrow.ts` (embed hypo-doc); `src/lib/llm/intent.ts` |
| R1 (hybrid) | new `src/lib/search/lexical.ts` (BM25); `src/lib/search/candidateFusion.ts` (already RRF); `src/lib/funnel/narrow.ts` |
| R2 (embeddings) | `src/lib/embeddings/embedder.ts`; `src/lib/env.ts` (`EMBEDDING_MODEL`); migration note for `Embedding` dim |
| R3 (cross-encoder) | new `src/lib/funnel/rerank.ts`; `src/lib/pipeline/runSearch.ts` |
| R4 (MMR) | new `src/lib/funnel/diversify.ts`; `src/lib/pipeline/runSearch.ts` |
| A1 (harness) | `scripts/eval/` (new): `gold.json`, `run-eval.mjs`, `metrics.mjs`, `report.mjs`; extends `scripts/search-benchmark.mjs` |
| A2 | `src/lib/llm/listwise.ts`, `src/lib/pipeline/runSearch.ts` (rankScore) |
| A3 | new `src/lib/feedback/*`; a `Feedback` Prisma model; `src/app/api/feedback/route.ts` |
| X1 | new `scripts/repo2vec/` (offline trainer) + `src/lib/embeddings/repo2vec.ts` |

All new diagnostics extend the existing `logs/search-debug.jsonl` (`SEARCH_DEBUG=true`) and
`logs/search-diagnostics.jsonl`. `logs/` is gitignored.

---

## 5. Phased execution

Each phase has: **Hypothesis · Design · Validation · Decision gate**. A phase is not "merged into the
branch's mainline of changes" until its decision gate says KEEP.

### Phase 0 — Measurement & infrastructure (BLOCKING, do first)

**Hypothesis:** we cannot improve what we cannot measure; a harness de-risks every later phase.

**Design:**
- Build `scripts/eval/gold.json`: 15–25 prompts spanning fields (frontend, systems, ML/data, devops,
  mobile, security, CLI tooling), complexity (1-word → full-sentence), and query *types* (capability,
  "alternative to X", named-ecosystem). For each prompt, label a **gold set** of known-relevant repos
  (`must_include` strong answers + `nice_to_have`) and known **traps** (popular-but-irrelevant repos that
  must NOT appear, e.g. zustand for "react data table").
- `scripts/eval/run-eval.mjs`: POST each prompt to `/api/search`, poll, collect top-15 + diagnostics,
  run **each prompt ≥2×**, persist raw runs to `logs/eval/<timestamp>.json`.
- `scripts/eval/metrics.mjs`: compute **Recall@15, nDCG@10, MRR, all-15-relevant rate, junk rate**
  (junk = stars<X ∧ future≈0 ∧ not in gold), plus **latency p50/p95** and **LLM cost/search** (parse
  pipeline log token counts), and **variance** across repeats.
- `scripts/eval/report.mjs`: pretty diff of two eval runs (baseline vs candidate) → a markdown table.
- Wire an `EVAL_TAG` env so a run can be labeled with the active feature flags.

**Validation:** run it twice on **v1.1.2 unchanged** → this is the frozen **baseline snapshot**
(`logs/eval/baseline-v1.1.2.json`). Confirm metrics are stable across repeats (variance sane).

**Decision gate:** harness produces a deterministic, re-runnable report; baseline captured. → proceed.

> ⛔ Until Phase 0 is green, no `B*/R*` change is evaluated or kept.

---

### Phase 1 — Breadth quick wins (`B1`, `B2`)

**Hypothesis:** the pool is the recall ceiling; cheaply enlarging/diversifying it lifts Recall@15 with
negligible cost (no extra LLM calls; same GitHub API-call count).

**Design:**
- `B1`: `per_page` 20→100 in `searchCandidatesDetailed`; keep `MAX_CANDIDATES` cap but raise to ~120–150
  so the bigger raw set actually survives into the funnel. Watch embedding-batch size/latency.
- `B2`: for the top 2–3 highest-signal queries, also issue `sort:stars` and `sort:updated` variants;
  fuse all via existing RRF. Flag: `SEARCH_SORT_VARIANTS=true`.

**Validation:** eval run vs baseline. Look specifically at **Recall@15** and at previously-missing
canonical repos (e.g. does real `SergioBenitez/Rocket` now enter the pool?). Track latency delta
(embedding batch grows).

**Decision gate:** KEEP if Recall@15 ↑ and p95 latency within +15%. If latency blows up, dial
`per_page`/`MAX_CANDIDATES` down to the knee of the curve. Revert `B2` independently if it adds latency
without recall.

---

### Phase 2 — Hybrid lexical + dense funnel (`R1`)

**Hypothesis:** the dense-only funnel under-weights exact rare terms (library names, "rocket"); adding a
lexical signal fused by RRF lifts precision for named/keyword-precise queries without hurting semantic ones.

**Design:**
- `src/lib/search/lexical.ts`: a small BM25 (or field-weighted TF) over `name∶description∶topics∶readmeHead`
  for the candidate pool (computed locally, no new service).
- In `narrow.ts`: produce two rankings — dense (existing) and lexical — and fuse with **RRF (k=60)** into
  the `prefilterScore`. Keep the credibility/recency terms. Flag: `HYBRID_FUNNEL=true`.

**Validation:** eval run; segment metrics by query type — expect biggest nDCG gains on
named/"alternative-to" prompts, neutral-to-positive on vague ones. Confirm no regression on the
semantic-only prompts.

**Decision gate:** KEEP if nDCG@10 ↑ overall and no query-type regresses materially. Tune the dense:lexical
fusion weight if one type regresses.

---

### Phase 3 — Embedding model upgrade (`R2`)

**Hypothesis:** `all-MiniLM-L6-v2`'s compressed 0.6–0.8 similarity band is a root cause of weak ranking; a
modern small model separates scores better and ranks correctly with less downstream heroics.

**Design:**
- Add `EMBEDDING_MODEL` to env; implement loader for `bge-small-en-v1.5` / `gte-small` / `nomic-embed-text`
  via Transformers.js (ONNX, still local/free). Evaluate `bge-m3` separately (it also yields sparse +
  multi-vector → could subsume `R1`).
- **Migration:** embedding dim may change (384→512/768/1024). The `Embedding` table / pgvector column dim
  must match; add a migration + re-embed path, and **namespace cached vectors by model** so a model swap
  invalidates stale cache instead of mixing dims. This is the one phase with a schema touch — plan it carefully.

**Validation:** eval run per candidate model; compare nDCG/Recall **and** embedding latency (bigger models
are slower). Inspect the similarity histogram (is the band wider?). A/B `bge-m3`'s built-in hybrid vs `R1`.

**Decision gate:** KEEP the model with the best nDCG-per-millisecond that stays within the latency budget.
If `bge-m3` hybrid ≥ `R1`+MiniLM, prefer it and retire the separate BM25 path.

---

### Phase 4 — HyDE query expansion (`B4`)

**Hypothesis:** embedding a *hypothetical ideal README* (the vocabulary repos actually use) instead of the
raw query closes the ask/describe vocabulary gap and lifts recall, especially for vague prompts.

**Design:**
- `src/lib/search/hyde.ts`: one short LLM generation → a 1–2 sentence "ideal repo description" per aspect
  (reuse the intent model; `temperature:0`; tight `maxTokens`). Embed it and **add it as an extra aspect
  vector** in the funnel's conjunctive blend. Flag: `HYDE=true`. Cache by normalized prompt.

**Validation:** eval run; expect recall/nDCG gains concentrated on short/vague prompts. Measure the added
intent-stage latency (should be one cheap call, overlap-able with GitHub search).

**Decision gate:** KEEP if vague-prompt nDCG ↑ and added latency < ~1s (run it concurrently with candidate
search so it's off the critical path). Revert if gains are noise.

---

### Phase 5 — Local cross-encoder rerank stage (`R3`)

**Hypothesis:** a cheap cross-encoder gives ~LLM-listwise precision at ~1/35th the latency, letting us
rerank a *wider* shortlist (60→20) before the LLM polishes 20→15 — more precision, no latency cost.

**Design:**
- `src/lib/funnel/rerank.ts`: load `bge-reranker-v2-m3` or `jina-reranker-v2` via ONNX (local). Score
  (query, repo-evidence) pairs for the top ~60 funnel survivors; take top ~20 into enrichment + LLM listwise.
- Widen `FUNNEL_TOP_N` feed accordingly; keep final output at 15. Flag: `CROSS_ENCODER_RERANK=true`.

**Validation:** eval run; compare nDCG/precision and **latency** (cross-encoder adds ms, but enrichment now
runs on a purer 20). Confirm the wider aperture surfaces gems the old 15-wide funnel dropped.

**Decision gate:** KEEP if precision ↑ and total latency within budget. If the local model is too slow on
CPU, reduce the rerank set size or evaluate a smaller reranker.

---

### Phase 6 — Graph expansion (`B3`, `R5`)

**Hypothesis:** the best alternatives often share no keywords; topic/dependency/co-star neighbors surface
them. This is the highest-ceiling *breadth* lever after the quick wins.

**Design (incremental — validate each sub-signal independently):**
- `B3a` topic co-occurrence: from top survivors' topics, fetch more repos via `topic:` qualifiers.
- `B3b` dependents/dependencies: resolve seed manifests → deps.dev / Libraries.io neighbors.
- `B3c` co-star CF seeds: "users who starred A also starred B" (OSS Insight API or GH Archive sample).
- `R5` intent typing: detect "alternative to X" / "X but lighter" → resolve X → seed B3a–c from X directly.
- New `src/lib/search/graphExpand.ts`; merge results into the pool **before** the funnel; tag provenance
  in diagnostics. Flags: `GRAPH_TOPICS`, `GRAPH_DEPS`, `GRAPH_COSTAR`.

**Validation:** eval run per sub-signal. Watch for two risks: (1) latency from extra API round-trips —
budget and parallelize; (2) topic drift adding noise — the funnel + cross-encoder must gate it.

**Decision gate:** KEEP each sub-signal independently only if it lifts Recall@15 net of any precision loss
after the funnel. Discard the ones that just add latency/noise.

---

### Phase 7 — MMR diversification (`R4`)

**Hypothesis:** users value a diverse-but-relevant shortlist; de-duplicating near-identical repos raises
perceived and measured usefulness.

**Design:** `src/lib/funnel/diversify.ts` — apply MMR (λ≈0.7 relevance / 0.3 diversity) over the final
candidate set using embedding distance, OR enforce sub-category coverage. Flag: `MMR_DIVERSIFY=true`.

**Validation:** eval run; add a **diversity metric** (mean pairwise distance of top 15 / sub-category count)
to the harness. Ensure Recall@15 and nDCG don't drop (diversity must not evict gold answers).

**Decision gate:** KEEP if diversity ↑ with no Recall/nDCG regression. Tune λ. This is a polish lever — fine
to ship conservatively.

---

### Phase 8 — Accuracy & calibration (`A2`, `A3` scaffolding)

**Hypothesis:** LLMs order well but calibrate `fit` poorly (saw a 0-star repo at fit=0.9); anchoring fit to
retrieval signals improves trust; logging feedback unlocks future LTR.

**Design:**
- `A2`: blend displayed `fit` with cross-encoder score + similarity; LLM keeps summary/missing/risks.
- `A3` (scaffold only this release): `Feedback` Prisma model + `/api/feedback` to log impressions/clicks;
  the LTR model itself is deferred until traffic exists. Ship the data capture now.

**Validation:** eval run for A2 (does anchored fit correlate better with gold labels?). A3 is plumbing —
validated by data appearing, not by relevance metrics.

**Decision gate:** KEEP A2 if fit↔gold correlation ↑. A3 ships if it's zero-risk and adds no latency.

---

### Phase 9 — Stretch (`X1`–`X3`), only if Phases 1–8 land with budget to spare

`repo2vec` star index (`X1`) is the most differentiating but is an offline pipeline (GH Archive → metric
learning). Treat as a spike: prototype, evaluate on the gold set's "alternative-to" prompts, and only
integrate if it beats graph expansion on breadth. `X2`/`X3` similar — opportunistic.

---

## 6. The iteration & validation loop (run this for EVERY phase)

```
for each feature F (in priority order, flag-gated, default OFF):
  1. branch hygiene: work on v1.1.3-search-overhaul; commit a clean checkpoint before F.
  2. implement F behind FEATURE_F flag; typecheck + unit tests must pass.
  3. capture CANDIDATE eval:  EVAL_TAG="F-on"  FEATURE_F=true   node scripts/eval/run-eval.mjs
  4. capture CONTROL eval:    EVAL_TAG="F-off" FEATURE_F=false  node scripts/eval/run-eval.mjs
     (control can reuse the latest baseline if nothing else changed)
  5. diff: node scripts/eval/report.mjs F-off F-on
  6. DECISION:
       KEEP   → flip flag default to true, document in .env.example + CHANGELOG, commit.
       REVISE → tune one parameter, GOTO 3 (cap at ~3 iterations, then decide).
       REVERT → delete/disable F, write a one-line "tried X, didn't help because Y" note, commit the note.
  7. re-run the FULL gold set after KEEP (not just F's prompts) to catch cross-feature regressions.
```

**Why "retest each question every time":** features interact. Hybrid funnel (`R1`) may make the
cross-encoder (`R3`) redundant; a better embedder (`R2`) may obviate HyDE (`R4`). After every KEEP we
re-run the entire gold set so a later win can't silently regress an earlier prompt. The harness is the
referee; intuition only proposes.

**Variance discipline:** every metric is the **median of ≥2 repeats**. A delta smaller than the observed
run-to-run variance is **not a win** — it's noise, and the feature is reverted or re-tested with more repeats.

---

## 7. Per-phase definition of done

A phase is DONE when: (a) flag implemented + documented; (b) typecheck + `pnpm test` green; (c) eval diff
captured in `logs/eval/`; (d) decision recorded (KEEP/REVERT + reason) in this PLAN's changelog section;
(e) full-gold-set regression re-run after a KEEP. No phase is "done" on intuition alone.

---

## 8. Gold set & metrics (the source of truth)

**Gold set (`scripts/eval/gold.json`):** ≥15 prompts, each with:
```json
{
  "prompt": "react data table",
  "field": "frontend", "complexity": "short", "type": "capability",
  "must_include": ["tanstack/table", "ag-grid/ag-grid", "glideapps/glide-data-grid"],
  "nice_to_have": ["mui/mui-x", "tabulator-tables/tabulator"],
  "traps": ["pmndrs/zustand", "reduxjs/redux", "pmndrs/jotai"]
}
```
Cover: capability queries, "alternative to X", named-ecosystem, vague 1-word, long-sentence; across
frontend / backend / systems / ML / devops / mobile / security / data.

**Metrics (`metrics.mjs`):**
- **Recall@15** = |gold(must+nice) ∩ top15| / |gold|. *Primary breadth metric.*
- **nDCG@10** with graded gain (must=2, nice=1, trap=−2). *Primary ranking metric.*
- **MRR** of the first must_include hit.
- **All-15-relevant rate**; **Junk rate**; **Trap-leak rate** (traps appearing in top 15).
- **Latency** p50/p95; **LLM cost/search** (token-based estimate).
- **Variance** across repeats; **Diversity** (added in Phase 7).

A change's report shows every metric for control vs candidate, with the variance band, and a verdict line.

---

## 9. Cost & latency budget (enforced by the harness)

- Reuse local/free compute first: embeddings, BM25, cross-encoder reranker all run locally (ONNX/CPU).
- The only paid calls remain: intent (1), HyDE (1, optional, concurrent), listwise (1). Net LLM calls
  should **stay flat or drop** vs v1.1.2 (which, post-1.1.2, is already 1 reliable listwise call).
- Parallelize every added network step (graph expansion, HyDE) off the critical path.
- If a feature is +quality but +cost, it ships **flag-off by default** with a documented tradeoff, not on.

---

## 10. Risk register & rollback

| Risk | Mitigation |
|---|---|
| Embedding-dim migration corrupts cached vectors | Namespace cache by model; migration + re-embed path; test on a copy first |
| GitHub rate limits from graph expansion | Bounded fan-out, parallel + cached, respect `GITHUB_TOKEN` budget |
| Cross-encoder too slow on CPU | Cap rerank-set size; pick a small reranker; flag-off if over budget |
| A feature wins on tuning prompts, overfits | Gold set spans fields/types; hold out a few prompts never used for tuning |
| GitHub Desktop auto-stash interfering (seen in v1.1.2) | Commit checkpoints frequently; verify `git status` before/after each phase |
| Feature interactions hide regressions | Mandatory full-gold-set re-run after every KEEP (§6.7) |
| Scope creep / endless tuning | ≤3 revise iterations per phase, then decide; stretch phases are explicitly optional |

**Rollback:** every feature is flag-gated, so rollback = flip the flag. Schema changes (R2) ship with a
down-migration. The branch keeps a clean checkpoint commit before each phase for `git revert` if needed.

---

## 11. v1.1.3 release checklist

- [ ] Phase 0 harness merged; `baseline-v1.1.2.json` captured.
- [ ] Each kept feature: flag defaulted on, `.env.example` documented, decision recorded below.
- [ ] Full gold-set eval: all §1 targets met, all guardrails respected.
- [ ] `pnpm typecheck` + `pnpm test` green; new unit tests for new modules.
- [ ] `NO_LLM_MODE=true` smoke test passes.
- [ ] `CHANGELOG.md` v1.1.3 entry; `package.json` bumped via the `update-version` skill.
- [ ] README config table + "How It Works" updated for shipped features.
- [ ] Final before/after eval table pasted into the release notes.
- [ ] Merge `v1.1.3-search-overhaul` → `master`.

---

## 12. Execution log (append KEEP/REVERT decisions here as we go)

> One line per phase outcome — the running record of what the numbers said.

- **Phase 0 — harness + baseline:** built `scripts/eval/{gold.json,run-eval.mjs,metrics.mjs,report.mjs}`
  (8 prompts × 2 repeats; metrics Recall@15, nDCG@10, PoolRecall, MRR, TrapLeak, Junk, latency).
  **Baseline v1.1.2:** nDCG@10 **0.665**, Recall@15 **0.557**, PoolRecall **0.839**, MRR 0.896,
  TrapLeak 0.31, Junk 0.31, latency p50 52s (TTL=0 forces fresh search). Captured.
- **All-features-on (smoke):** REGRESSED rust — latency 98s (over budget) + benchmark/name-collision
  noise (webframework-bench, NVIDIA/warp) crowding out actix/poem/salvo. → ablate.
- **Topic expansion (`GRAPH_TOPICS`) — REVERT:** pulls "benchmark"/"comparison" meta-repos into the pool
  (topic:web-framework matches them) and adds ~3 searches of latency. Net noise.
- **MMR (`MMR_DIVERSIFY`) — REVERT:** λ=0.7 promotes diverse-but-irrelevant repos (NVIDIA/warp) over
  canonical ones; displaces relevant results. Diversity not worth the precision loss on these queries.
- **Hybrid BM25 funnel (`HYBRID_FUNNEL`) — REVERT:** lexical signal rewards keyword-stuffed names —
  "rust-web-framework-comparison", "*-benchmark" repos surge; salvo/poem dropped. With it OFF salvo
  returns to #2. (A *cross-encoder* reranker — semantic, not lexical — is the right precision tool here;
  see deferred R3.)
- **Lean config `{per_page=40, sort-variants, HyDE}` vs baseline — KEEP:** nDCG **0.665→0.715**
  (+0.050), PoolRecall 0.839→**0.890**, MRR →**1.000**, **Junk 0.31→0.00**, TrapLeak 0.31→0.19.
  Kubernetes +0.50 and far more stable. Cost: p95 latency 63→79s (sort variants add searches).
- **HyDE ablation (`lean` vs `leanNoHyde`):** removing HyDE regressed every quality metric, BUT this was
  **confounded by GitHub pool variance** — PoolRecall dropped 0.890→0.784 even though HyDE cannot affect
  the pool (it only shifts the funnel query vector). ⇒ **TTL=0 fresh searches have high pool variance;
  2 repeats can't isolate ranking features from pool noise.** Methodology corrected: freeze pools (cache).
- **Cross-encoder rerank (R3) — KEEP:** `Xenova/ms-marco-MiniLM-L-6-v2` (~90 MB, local/free). Clean
  relevance separation (relevant logit +7.3 vs irrelevant −11.4 — far better than MiniLM's compressed
  0.6–0.8 band). Frozen-ish A/B (still partly confounded by LLM query non-determinism shifting cache
  keys): targeted wins exactly where the widened pool buried canonical answers — **vector-db +0.15**
  (qdrant/weaviate recovered), **rust +0.20**, **firebase +0.21**, TrapLeak 0.25→0.13; latency +4s p50.
- **Hybrid BM25 / topics / MMR — REVERTED** (see above; net noise or harm).
- **Methodology finding (important):** search A/B at this scale is dominated by two noise sources —
  (1) GitHub returns different pools for the same query across calls; (2) temperature-0 LLM intent still
  varies via provider routing, changing query strings → different cached pools. Reliable attribution
  needs frozen seeds/pools AND ≥3 repeats; small (<0.03 nDCG) deltas here are not trustworthy.
- **Confirmation eval `{per_page=40, sort, HyDE, cross-encoder}` vs baseline (REPEATS=3):** robust wins —
  **TrapLeak 0.31→0.13 (−58%)**, **Junk 0.31→0.17**, AllRelevant +0.02, latency p50 52→40s, and big
  per-prompt gains (rust +0.16, kubernetes +0.20, firebase +0.15). BUT aggregate **nDCG flat (−0.008)**
  and MRR −0.12 — one bad react pool-draw (0.17) dragged the mean; variance, not a systematic regression.
- **CE-without-HyDE smoke (final-config check) — REGRESSION:** vector-db canonical DBs (qdrant #8,
  milvus #10, weaviate #11) got buried under tiny text-similar demos (duckdb-embedding-search 149★,
  fut=0, at #1). The cross-encoder over-weights surface text; its earlier vector-db win was entangled
  with HyDE. Reproducible, not noise. ⇒ cross-encoder is NOT a safe default.
- **FINAL DECISION — ship all features OPT-IN (default OFF); v1.1.3 default == v1.1.2.** Honest reading of
  "keep-only-if-it-helps": no feature was a robust enough *aggregate* win to default-on without risking a
  regression somewhere (CE buries vector-db; breadth alone trades kubernetes-recall for vector-db-precision;
  HyDE ambiguous; hybrid/topics/MMR net-negative). What ships as real value:
    1. the **eval harness** (gold set + metrics + report) — lasting infrastructure;
    2. a documented **retrieval toolbox** (per_page, sort-variants, HyDE, cross-encoder, + 3 reverted) each
       flag-gated with its measured tradeoff, enable-and-re-measure-per-corpus;
    3. the **findings** below.

### Findings (first-principles)
1. **The v1.1.2 baseline is already strong** (the listwise-reliability fix was the dominant lever); further
   aggregate gains are small and hard-won.
2. **Breadth ⟂ precision tradeoff:** enlarging the pool (per_page, sort, topics) lifts recall on
   under-covered queries (kubernetes) but buries the few canonical answers on queries with many
   similar-but-lesser repos (vector-db). No tested reranker resolved both at once.
3. **Cross-encoders reward surface text:** great for "is this on-topic" (cuts traps) but they can rank a
   keyword-perfect 0-star demo above the canonical 30k-star project. Needs a credibility/authority co-signal
   (future work: blend CE with stars/PageRank, or use CE to *filter* not *reorder*).
4. **Lexical (BM25) fusion backfires on meta-repos:** "awesome-*", "*-benchmark", "*-comparison" names are
   keyword-perfect but useless as answers.
5. **Measurement is the bottleneck:** GitHub pool variance + temp-0 LLM query drift swamp sub-0.03 nDCG
   deltas; trustworthy A/B needs frozen pools/seeds and ≥3 repeats. This harness is the prerequisite for any
   future, confident search change.

---

### Appendix — quick commands

```bash
# baseline / candidate eval
node scripts/eval/run-eval.mjs            # uses current flags + EVAL_TAG
node scripts/eval/report.mjs <ctrl> <cand>

# single ad-hoc query with full debug trace
SEARCH_DEBUG=true node scripts/run-search.mjs "kubernetes monitoring and observability"

# gates
pnpm typecheck && pnpm test
```

*This plan is a living document. The phase order is a hypothesis; the harness is the authority. Update §3
ordering and §12 as evidence arrives.*
