# RepoRadar Reflection Report

Date: 2026-06-02

## Executive Summary

RepoRadar is a serious early implementation of semantic GitHub repository discovery. Its current pipeline is: natural-language prompt -> LLM or heuristic intent extraction -> multiple GitHub Search queries -> candidate dedupe -> local MiniLM embedding funnel -> GitHub enrichment -> LLM or deterministic scoring -> ranked, explained results. In live testing, it successfully found several canonical repositories without the prompt naming them: `pmndrs/zustand`, `fastapi/fastapi`, `yjs/yjs`, `loro-dev/loro`, `encode/httpx`, `aio-libs/aiohttp`, `coollabsio/coolify`, `SeleniumHQ/selenium`, and `puppeteer/puppeteer`.

The main first-principles limitation is that RepoRadar is not yet a universal semantic search engine. It is a semantic reranker over a small, GitHub-Search-derived candidate pool. If the right repository is not in that pool, later embeddings and LLM scoring cannot recover it. If the right repository is in the pool but has sparse metadata or loses in the local embedding funnel, it can still be dropped before the richer README evidence is considered. The live tests showed both categories of failure.

The most important improvement is to separate recall from ranking more aggressively. RepoRadar needs a wider multi-channel candidate generator, a durable repo index or at least a larger cached semantic corpus, soft constraint handling, canonical repo detection, duplicate suppression, stronger repository-type classification, and a real benchmark suite with known-answer queries. Those changes are implementable in stages without throwing away the current architecture.

## What I Inspected and Tested

I inspected the project documentation and the core implementation files: `README.md`, `REPORADAR.md`, `PLAN.md`, `PROGRESS.md`, `package.json`, `src/lib/llm/intent.ts`, `src/lib/github/search.ts`, `src/lib/funnel/narrow.ts`, `src/lib/github/enrich.ts`, `src/lib/llm/score.ts`, `src/lib/scoring/deterministic.ts`, `src/lib/pipeline/runSearch.ts`, `src/lib/pipeline/persist.ts`, `src/lib/api/serialize.ts`, and the Prisma schema.

I ran `pnpm typecheck`; it passed. I started the dev server on `http://localhost:2000`. `node scripts/cli.mjs health` returned `status: ok`, `db: true`, `pgvector: true`, `llmEnabled: true`, and model `google/gemini-2.5-flash-lite`.

One operational issue appeared: `pnpm db:deploy` failed with Prisma `P3018` because migration `20260602000000_add_enrichment_cache` tried to create `repo_enrichments`, but that relation already exists. The migration SQL itself says those tables were previously applied locally through `prisma db push`. I did not mutate migration history because the app was still healthy and live searches worked.

## How the Current Search Method Works

Intent extraction is in `src/lib/llm/intent.ts`. In normal mode, the LLM normalizes the prompt, creates orthogonal aspects, keywords, required features, project type, optional constraints, and 6-8 GitHub query strings. The prompt explicitly encourages domain expansion, for example adding names such as Zustand, Jotai, FastAPI, Yjs, Automerge, TipTap, Lexical, Playwright, or Selenium when relevant. In fallback mode, `heuristicIntent` extracts stopword-filtered keywords, exact language tokens, licenses, recency hints, and a smaller query set.

Candidate generation is in `src/lib/github/search.ts`. The app runs only the first `MAX_SEARCH_QUERIES` query variants; the current environment uses `MAX_SEARCH_QUERIES=4`. Each query requests 20 repositories by default, dedupes by GitHub id, drops archived repos and GitHub-marked forks, and caps the pool at `MAX_CANDIDATES=80`. There is a zero-result fallback that strips hard qualifiers from the first query, but only when the whole pool is empty.

Narrowing is in `src/lib/funnel/narrow.ts`. It embeds candidate text with `Xenova/all-MiniLM-L6-v2`. The candidate text is only `fullName`, description, topics, and primary language, not README content. If the LLM produced multiple aspects, the funnel embeds each aspect and uses a conjunctive similarity function so one strong aspect cannot fully rescue a weak aspect. The prefilter score is 80 percent semantic similarity, 11 percent recency, 6 percent license, and 3 percent stars. Only `FUNNEL_TOP_N=15` survivors are enriched and scored.

Enrichment is in `src/lib/github/enrich.ts`. Survivors get README, root manifests, release counts, issue/PR counts, docs signals, and organization ownership through batched GraphQL, with a minimal fallback. README content is truncated to 6000 characters. The scorer then uses either LLM scoring in `src/lib/llm/score.ts` or deterministic scoring in `src/lib/scoring/deterministic.ts`. Final ranking in `runSearch.ts` is relevance-driven: LLM fit plus similarity, with a small relevance-gated popularity prior.

## Live Search Results

| Prompt, without naming the expected repo | Result quality observed |
|---|---|
| "lightweight React state management library for simple global stores without Redux boilerplate" | Strong. Top results were `pmndrs/zustand`, `pmndrs/jotai`, `nanxiaobei/resso`, and other relevant state libraries. Weakness: an irrelevant but healthy infra repo, `hashicorp/nomad`, appeared in the top 10. |
| "Python web API framework with type hints validation and automatic OpenAPI documentation" | Strong rank 1: `fastapi/fastapi`. Weakness: templates and examples such as `FastAPI-Template` and project-specific FastAPI apps ranked high because they matched README keywords. |
| "JavaScript rich text editor for block based documents like a Notion style editor with markdown support" | Weak. It returned `nextcloud/text`, markdown editors, and small demos, but missed canonical editor libraries such as `ueberdosis/tiptap`, `facebook/lexical`, `TypeCellOS/BlockNote`, `ianstormtaylor/slate`, and `ProseMirror/prosemirror`. The extracted language was hard `JavaScript`, which excluded TypeScript-classified canonical repos and distorted the pool. |
| "local first collaborative data sync library using CRDTs for web apps" | Strong. Top results included `yjs/yjs`, `loro-dev/loro`, `streamich/json-joy`, and `pubkey/rxdb`. This is the method's best case: distinctive domain terms plus good LLM expansion. |
| "Python library for calling REST APIs with a clean client API and both synchronous and asynchronous support" | Mostly strong. `encode/httpx` ranked first, with `aio-libs/aiohttp`, `psf/requests`, and `urllib3/urllib3` also found. Weakness: `pydantic/httpx2`, a duplicate/fork-like repo, ranked second. |
| "self hosted Heroku style platform to deploy apps and containers on my own server" | Mixed. `coollabsio/coolify` ranked first, but canonical alternatives `dokku/dokku` and `caprover/caprover` were absent from the final top 15, while profile or mirror-style repos such as `api-evangelist/dokku` and duplicated `sailbox`/`coolify` repos appeared. Direct GitHub search for `dokku OR caprover OR coolify` returns the canonical repos immediately, so query expansion/candidate strategy is the issue. |
| "tool that controls real browsers from code so I can click through a website and verify the UI works" | Mixed. It found `SeleniumHQ/selenium` and `puppeteer/puppeteer`, but missed `microsoft/playwright` in the final top 15. The LLM did include `playwright` in keywords and generated `puppeteer OR playwright OR selenium`; an authenticated direct GitHub call for that query returned `microsoft/playwright` at rank 4. Therefore the likely failure is after candidate retrieval, in the funnel or ranking stage. |

## 1. Strengths of the Current Search Method

The strongest part is LLM-assisted query expansion. When the prompt describes a known ecosystem need, the intent model often adds the right latent vocabulary and known project names. That is why prompts that never named Zustand, FastAPI, Yjs, Loro, HTTPX, Selenium, or Coolify still found them.

The second strength is a clean staged architecture. Retrieval, narrowing, enrichment, scoring, persistence, and serialization are separate enough to improve independently. The current design already has caching for candidate searches and enrichment, local embeddings, pgvector storage, deterministic fallback, background jobs, and score explanations.

The third strength is cost control. It does not enrich or LLM-score every GitHub result. It narrows to 15 survivors and scores only the configured top subset with the LLM. This makes the app usable as a live web search tool rather than a slow crawler.

The fourth strength is transparency. The UI/API stores fit, future, underrated, component scores, matched features, missing features, risks, docs signals, metrics, and similarity. This is much better than returning opaque search results.

The fifth strength is the conjunctive aspect idea. Multi-aspect prompts are not treated as one bag of words; each facet can constrain relevance. This is the right direction for "I need X for Y on Z" queries.

The sixth strength is that quality and relevance are not fully collapsed. The final rank is mostly relevance, while health/future is displayed separately. That is correct: a healthy but wrong repository should not outrank a directly relevant repository.

## 2. Weaknesses and Limitations

The core weakness is recall. RepoRadar relies on live GitHub Search for the initial candidate pool, then throws away everything outside at most 80 candidates and 15 funnel survivors. This cannot be universal. A universal plain-language repo engine needs the ability to consider relevant repos even when GitHub's keyword search did not put them in the first few pages.

Hard filters are too dangerous. The editor test showed this clearly: a user saying "JavaScript" can mean "works in the JavaScript ecosystem", but GitHub `language:JavaScript` excludes TypeScript-majority repos. The code already knows JS and TS are interchangeable during deterministic scoring, but the hard GitHub filter has already damaged recall before scoring.

Candidate text is too shallow before the funnel. The funnel ranks on full name, description, topics, and language, but README and manifest evidence arrive only after the top 15 are selected. Many excellent repos have generic descriptions, sparse topics, or terminology that only appears in the README. Those repos can be dropped before the system reads the evidence that would prove relevance.

The embedding model is useful but weak as a universal semantic judge. `all-MiniLM-L6-v2` is fast and local, but its cosine scores are compressed and not domain-calibrated for repository discovery. In the tests, many unrelated or only-adjacent repos had similarities around 0.68-0.75. That makes fine ranking fragile.

The method has no durable broad corpus. pgvector is present, but the live search path is not querying a comprehensive embedded repository index. It mostly embeds the current GitHub Search candidates. That means RepoRadar is not yet "semantic search over GitHub"; it is "semantic reranking of a small GitHub Search sample."

Repository-type classification is not strict enough. Templates, demos, examples, docs profiles, SDKs for a single service, and apps can outrank actual reusable libraries or frameworks. The FastAPI and HTTP-client tests showed this. The requested `projectType` influences scoring, but it does not reliably enforce the artifact type.

Canonicality and duplicate suppression are weak. The tests surfaced `pydantic/httpx2`, `api-evangelist/dokku`, `api-evangelist/coolify`, duplicate `sailbox` repos, and zero-star Coolify-looking repos. GitHub's `fork` flag is not enough; mirrors, profiles, generated API descriptions, stale copies, and renamed clones need their own detection.

Known-answer coverage is not guaranteed even when query expansion names the answer. The Playwright test is the clearest case: the query expansion included `playwright`, and GitHub returns `microsoft/playwright` for the generated OR query, but the final result set omitted it. This indicates that the funnel/ranking stage can discard canonical candidates.

LLM scoring can overtrust keyword evidence. A repo that says all the right words in a README can get a high fit even if it is a tutorial, a single-app backend, or a thin wrapper. Conversely, canonical repos with broad descriptions may not look specific enough.

Some health metrics are approximate. Star velocity is documented as approximated. Contributor health uses available GraphQL signals, but the current enrichment fetches `mentionableUsers.totalCount`, which is not the same as recent active contributors or bus factor. Future scores are useful hints, not reliable maintenance forecasts.

The debug CLI has a presentation bug: API results store stars under `metrics.stars`, but `scripts/cli.mjs` prints `repo.stars`, so all live CLI output showed `star ?`. The API data is present; the CLI display is wrong.

The database migration state is inconsistent. The app works, but `pnpm db:deploy` fails because cache tables exist while the migration is marked failed. That is not a search-quality flaw, but it hurts reproducibility and deployment confidence.

## 3. Implementable Steps to Greatly Improve Generalizability and Accuracy

First, build a benchmark harness before changing ranking weights. Add a `scripts/eval-search.mjs` or similar that runs a curated set of 100-300 prompts with expected canonical repos, acceptable alternatives, excluded bad types, and required artifact type. Track Recall@80, Recall@15, MRR, nDCG@10, duplicate rate, type-violation rate, and canonical-miss cases. Include the seven prompts from this report as seed cases.

Second, log and persist candidate-pool diagnostics. For every search, store generated queries, per-query result lists, whether expected canonical repos entered the pool, funnel scores for all candidates, and reasons for exclusion. Without this, failures are hard to classify. The Playwright case should be answerable directly: "was `microsoft/playwright` absent from GitHub results, below funnel cutoff, or below final rank?"

Third, make language constraints soft by default. Treat `JavaScript`, `TypeScript`, `Node`, `React`, and similar ecosystem words as compatibility preferences, not hard GitHub `language:` filters, unless the user explicitly says "must be written primarily in X". Always issue at least one no-language query and, for JS/TS ecosystem prompts, issue both JS and TS variants.

Fourth, widen recall adaptively. Run more than four query variants when early candidates are low-confidence, homogeneous, or missing obvious canonical names. Increase `per_page` for high-value OR/name queries, use the second page for broad queries, and keep latency bounded with caching and concurrent requests. The current 4 x 20 retrieval budget is too small for universal discovery.

Fifth, add a canonical-name rescue pass. After intent extraction, ask "what canonical repos should be considered for this intent?" using a constrained LLM prompt or a local gazetteer, then perform targeted exact-name searches or direct repository fetches for those candidates. This should not blindly rank them; it should only guarantee they enter the candidate set for evidence-based scoring.

Sixth, build a lightweight repository knowledge base. Start with a practical corpus: top GitHub repos by topic/language, package registry projects from npm/PyPI/crates/go, curated awesome lists, GitHub trending snapshots, and repos discovered from prior searches. Store descriptions, topics, README chunks, manifests, package names, homepage, and embeddings. Then retrieve candidates with hybrid BM25 plus vector search before calling live GitHub.

Seventh, enrich before the hard funnel, at least lightly. For the top 80-150 raw candidates, fetch README snippets or cached README chunks before final narrowing. A two-pass approach works: cheap metadata funnel to 100, light README/manifest enrichment to 40, cross-encoder or LLM rerank to 15, deep enrichment and scoring for the final set.

Eighth, replace pure bi-encoder reranking with a stronger reranker. Keep MiniLM for cheap recall, but add a cross-encoder reranker or LLM listwise reranker over the top 40-100 candidates. The reranker should compare the full prompt, aspects, README snippets, repo type, and canonicality signals.

Ninth, add explicit repository-type classification. Create a classifier with labels such as library, framework, CLI, app, template, demo, tutorial, awesome-list, docs/profile, generated SDK, fork/mirror, plugin, extension, dataset, and research prototype. Enforce hard downranks when the user asks for a library but the candidate is a template or profile repo.

Tenth, add canonicality and duplicate grouping. Group repos by package name, homepage, README title, GitHub fork network, owner/name similarity, upstream references, and manifest metadata. Prefer the canonical upstream over mirrors, generated API profiles, tutorial repos, and abandoned copies. This would fix cases like `api-evangelist/dokku`, duplicate Coolify/Sailbox repos, and `pydantic/httpx2`.

Eleventh, improve quality metrics separately from relevance. Implement real star velocity from snapshots or stargazer sampling, recent active contributors from commit history, release cadence from tags/releases, issue response time, stale PR ratio, package download stats, and security/archive/license signals. Use these as filters and tie-breakers, not as substitutes for fit.

Twelfth, add a result-set audit before final output. After ranking, run a cheap verifier that asks: "What major canonical projects are missing, and were they considered?" If a likely major project was not considered, fetch and score it. If it was considered and rejected, expose the reason internally and optionally in debug UI.

Thirteenth, expose search transparency in the UI. Show expanded queries, applied hard filters, candidate count, whether language was treated as hard or soft, and a "broaden search" option. Let users mark results as relevant, irrelevant, duplicate, wrong artifact type, or missing expected repo. Feed that back into the benchmark set.

Fourteenth, fix operational issues. Resolve the Prisma migration state safely, make the cache-table migration idempotent or mark it applied after verifying the schema, and fix the CLI star display to read `metrics.stars`. These do not make search smarter, but they make testing and iteration trustworthy.

## Prioritized Roadmap

Immediate: add the benchmark harness, candidate diagnostics, CLI star fix, soft JS/TS language handling, and canonical rescue for LLM-suggested known repos. These changes are small and directly address failures observed in the tests.

Next: add repo-type classification, duplicate/canonical grouping, adaptive query broadening, and light README enrichment before the top-15 cutoff. These changes should materially improve both recall and precision without requiring a full GitHub crawler.

Longer term: build the durable hybrid search index over a broad repository corpus and add a stronger reranker. That is the step that turns RepoRadar from a smart wrapper around GitHub Search into a real semantic GitHub repository search engine.

## Bottom Line

RepoRadar's current method is good when the user's idea maps to distinctive ecosystem vocabulary and the LLM expands the prompt into the right terms. It is not yet universal because the first retrieval stage is still small, keyword-bound, and dependent on GitHub Search. The path forward is not to make the final LLM scorer more clever; the path forward is to improve recall, evidence coverage, canonicality, artifact-type filtering, and evaluation. Once the right repositories reliably enter the candidate set, the existing enrichment and explanation architecture becomes much more valuable.

Goal execution note: the active goal completed in about 15 minutes; no explicit token budget was set.
