---
name: Bug report
about: Report broken search, scoring, setup, or UI behavior
title: "[bug] "
labels: bug
---

## What happened?

Describe the issue and what you expected instead.

## Search query or page

Paste the prompt, filters, or URL involved.

## Environment

- OS:
- Node:
- pnpm:
- `NO_LLM_MODE`:
- Database: local Docker / hosted / other

## Evidence

Paste relevant output from:

```bash
pnpm typecheck
```

And check:

```text
http://localhost:2000/api/health
```

If this is a search issue, include relevant lines from `logs/pipeline.log`.
