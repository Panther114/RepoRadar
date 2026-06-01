<div align="center">

# 🛰️ RepoRadar

### Open source has a discovery problem. RepoRadar fixes it — both ways.

**Find the right project by what it _does_, not what it's _called_ — and give great-but-unknown projects a fair shot at being found.**

[![Made with Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Postgres + pgvector](https://img.shields.io/badge/Postgres-pgvector-336791?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Local embeddings](https://img.shields.io/badge/embeddings-local%20%26%20free-34d399)](#-no-credit-card-required)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-38bdf8.svg)](#-contributing)

</div>

---

## The problem

Every day, developers reinvent things that already exist — and brilliant, well-maintained
open-source projects die in obscurity because they didn't win the keyword lottery.

GitHub search rewards **stars, exact keywords, and SEO**. That means:

- 🔍 **Builders** can't find projects by _functionality_ ("a maintained TypeScript library for a
  local-first Notion-like editor"), so they settle for the first popular result — or rebuild it.
- 🌱 **Maintainers** of excellent small projects stay invisible, no matter how good their code,
  docs, or momentum are. Popularity compounds; quality doesn't.

The result is a slower, more wasteful, less meritocratic open-source ecosystem.

## The idea: a two-way discovery engine

RepoRadar is a semantic search **and evaluation** engine that works in both directions:

| For builders 🧑‍💻 | For maintainers 🌱 |
|---|---|
| Describe what you need in plain English and get a **ranked, explained** shortlist. | Get judged on **merit** — fit, maintenance, docs, momentum — not star count. |
| See **why** each repo matches, its **risks**, and what it's **not** good for. | A dedicated **"Underrated Matches"** lane surfaces strong projects the world is sleeping on. |
| Compare alternatives side-by-side with transparent scores. | An evidence-grounded report that turns "unknown" into "discoverable." |

> **The mission:** make open source more meritocratic. When the best tool for the job can actually
> _be found_ — regardless of who made it or how famous it is — everyone builds faster and the whole
> commons gets healthier.

---

## What it does

For any natural-language query, RepoRadar returns a ranked list where every result carries three
transparent, explainable scores:

- **🎯 Fit** — how well the repo matches your actual functional intent (semantics + features +
  language/framework + manifests + constraints + project type).
- **🔮 Future** — how likely it is to stay useful: recent activity, release cadence, issue/PR
  health, contributor health, docs quality, ecosystem signals (minus risk penalties).
- **💎 Underrated** — high quality + strong momentum **minus** popularity saturation, so a superb
  500-star project can rank above a loosely-relevant 60k-star one.

Plus: **"Best of" rails** (Best Overall, Best Maintained, Best Underrated, Best Documentation,
Lowest Risk), an **Underrated Matches** section, a **compare** drawer, and a per-repo **detail page**
with radar charts, release cadence, and README evidence snippets.

---

## How it works — deterministic funnel, AI judgment

RepoRadar is **not** "ask an LLM to rank repos." It's a cost-aware pipeline that puts cheap,
deterministic work first and reserves the model for what only a model can do:

```
your prompt
  → intent + constraints + query expansion
  → GitHub search (multiple variants) → dedupe → candidate pool (~50–120)
  → DETERMINISTIC FUNNEL: filters + LOCAL embedding similarity + cheap signals
        ↓ narrows to the top ~15 survivors        ← keeps it fast & cheap
  → deep enrichment (README, manifests, releases, issues, contributors)
  → AI SCORING: the model produces Fit / Future / Underrated + evidence
  → ranked, explainable results + charts
```

Every explanation is **grounded in fetched repository evidence** — never vibes. The scoring rubric
is published in the UI and in code, so the numbers are auditable.

---

## ✨ No credit card required

- **Embeddings run locally and free** via Transformers.js (`all-MiniLM-L6-v2`) — no API key, runs on
  a laptop.
- **`NO_LLM_MODE=true`** runs the entire app end-to-end with **zero paid services** (deterministic
  funnel ordering, no AI scores) — perfect for trying it, demos, and CI.
- The optional LLM layer is **model-agnostic** through an OpenAI-compatible endpoint (OpenRouter by
  default). Point `OPENROUTER_MODEL` at a cheap DeepSeek model, a GPT model, or anything else — swap
  with one env var.

This makes RepoRadar genuinely **self-hostable by anyone**, which is the whole point: a public good
shouldn't be locked behind a paywall.

---

## 🚀 Quick start

```bash
# 1. configure
cp .env.example .env        # keep NO_LLM_MODE=true to run 100% free

# 2. database (Postgres + pgvector)
docker compose up -d

# 3. install + migrate + run
pnpm install
pnpm db:deploy
pnpm dev
```

Open **http://localhost:2000** and search. Full instructions (env vars, API key, troubleshooting,
moving machines) are in **[`setup.txt`](./setup.txt)**, and the architecture + status live in
**[`PLAN.md`](./PLAN.md)** and **[`PROGRESS.md`](./PROGRESS.md)**. The top bar also includes an
**About** page that explains the pipeline and the score composition.

---

## 🧱 Tech stack

- **Next.js (App Router) + TypeScript + Tailwind** — full-stack, one deployable app
- **Postgres + pgvector** via **Prisma** — caching + semantic search
- **Transformers.js** — local, free 384-dim embeddings
- **OpenAI-compatible LLM** (OpenRouter / DeepSeek by default) — evidence extraction + scoring
- **Recharts + TanStack Query** — radar charts, trends, live progress
- **Docker Compose** locally · deploys to **Railway**

---

## 🗺️ Roadmap

- [ ] `npx reporadar "query"` CLI
- [ ] Browser extension that scores repos right on their GitHub page
- [ ] GitHub Action to evaluate your dependencies for abandonment risk
- [ ] Public, shareable result pages ("here's the best RAG library, with receipts")
- [ ] Package-registry signals (npm / PyPI / crates download trends)
- [ ] Maintainer dashboard: "here's why your project is/ isn't getting discovered"
- [ ] True star-velocity history & momentum alerts

See [`PLAN.md`](./PLAN.md) for the build stages and [`PROGRESS.md`](./PROGRESS.md) for current status.

---

## 🤝 Contributing

RepoRadar is built to be a community good — contributions are very welcome.

- Try a search, then open an issue with queries where the ranking felt wrong (with the repo + why).
- Improve the scoring rubric, add data sources, or tune the funnel.
- Good first issues: new manifest parsers, more chart types, accessibility, i18n.
- Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local setup, PR expectations, and good first contribution areas.

The scoring formulas are intentionally transparent (`src/lib/scoring/rubric.ts`) so anyone can debate
and improve them in the open.

## ⭐ Why star this?

If you believe the best open source should win on **merit, not marketing** — star it. Stars here do
something poetic: they help build the very tool that stops great projects from needing stars to be
found.

## 📄 License

[MIT](./LICENSE) — free to use, self-host, fork, and build on.
