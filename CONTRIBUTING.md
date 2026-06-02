# Contributing to RepoRadar

RepoRadar is for developers who need better open-source discovery than keyword search. Good contributions make search more accurate, faster, easier to inspect, or easier to self-host.

## Good first contributions

- Improve the search algorithm to fetch more relevant github repositories, this is one aspect that I am currently struggling with. Suggestions are fine.
- Improve UI layout. The current UI design is inspired by Github

## Local setup

```bash
pnpm install
docker compose up -d
pnpm db:deploy
pnpm dev
```

Open `http://localhost:2000`.

For free local testing, keep `NO_LLM_MODE=true`. For AI scoring, set `OPENROUTER_API_KEY` and `NO_LLM_MODE=false`.

## Before opening a pull request

```bash
pnpm typecheck
```

Also run one search in the UI and confirm `/api/health` reports `db:true` and `pgvector:true`.

## What to include in a PR

- The problem or search query you are improving.
- Before/after behavior.
- Any cost, latency, or rate-limit impact.
- Screenshots for UI changes.
