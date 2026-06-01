# RepoRadar.md

# RepoRadar

RepoRadar is a semantic GitHub repository discovery and evaluation engine.

It lets a user describe the kind of repository they want in natural language, then returns ranked GitHub repositories based on:

1. **Intent fit** — how closely the repository matches the user's actual functional need.
2. **Future score** — how likely the repository is to remain useful, maintained, and relevant.
3. **Evidence quality** — how much verifiable repository evidence supports the ranking.
4. **Underrated potential** — whether a smaller repository is high-quality despite low star count.

RepoRadar is not meant to be a clone of GitHub Search. GitHub Search is mostly keyword/metadata based. RepoRadar should behave more like an OSS research assistant: it searches, inspects, scores, compares, and explains repositories.

---

## 1. Product Thesis

### Core Problem

Developers often need to find open-source projects by functionality, not by exact keyword.

Examples:

- "Find a maintained TypeScript library for building a Notion-like editor."
- "Find a lightweight open-source alternative to Firebase Auth for Next.js."
- "Find an actively maintained repo that implements RAG over PDFs with local models."
- "Find small but promising GitHub projects for agentic coding workflows."
- "Find a backend framework that is similar to FastAPI but works better with Bun."

GitHub's native search often fails these queries because:

- It depends heavily on exact keywords, stars, topics, and README terms.
- Popular repositories dominate visibility.
- Small high-quality projects are hard to discover.
- Search results do not explain why a repo matches the user's intent.
- Search results do not provide maintainability, risk, or momentum analysis.
- The user must manually open many repos, read READMEs, check issues, inspect commits, and compare alternatives.

RepoRadar solves this by ranking repositories based on both semantic relevance and repository health.

---

## 2. Positioning

### One-line Description

RepoRadar is a semantic search and evaluation engine for discovering GitHub repositories by functionality, maintainability, and momentum.

### More Precise Description

RepoRadar takes a natural-language prompt, searches GitHub for candidate repositories, enriches each candidate with repository metadata and README/package evidence, computes a transparent **Fit Score** and **Future Score**, then returns an explainable ranked list with charts, risks, and alternatives.

### What RepoRadar Is

- A GitHub repository discovery engine.
- A semantic search layer over GitHub.
- A repository evaluator.
- A tool for comparing open-source projects.
- A way to surface underrated high-quality repositories.
- A developer-facing research assistant for OSS dependency selection.

### What RepoRadar Is Not

- Not a general web search engine.
- Not a replacement for GitHub.
- Not a code-search engine like Sourcegraph.
- Not a star-count leaderboard.
- Not an AI wrapper that blindly asks an LLM to rank repos.
- Not a full-GitHub crawler in v1.

---

## 3. Main User Flow

### Input

User enters a natural-language query:

```text
Find a maintained TypeScript library for building a local-first Notion-like editor with markdown support.
```

Optional filters:

```text
language: TypeScript
license: MIT or Apache-2.0
minimum activity: pushed within 6 months
project type: library
stars: any
include small projects: true
```

### Processing

RepoRadar:

1. Parses the user's intent.
2. Expands the query into multiple GitHub-compatible search queries.
3. Searches GitHub for candidate repositories.
4. Fetches metadata for candidate repositories.
5. Fetches README and selected repository files.
6. Computes semantic similarity between the query and repository evidence.
7. Computes deterministic health and momentum metrics.
8. Uses a cheap model only for structured evidence extraction and final explanations.
9. Produces a ranked list.

### Output

For each repository:

```text
Repository: owner/name
Fit Score: 0.91
Future Score: 0.84
Underrated Score: 0.76

Why it matches:
- TypeScript-first editor framework.
- Markdown support appears in README and package metadata.
- Has plugin architecture.
- Recently maintained.

Risks:
- Smaller ecosystem than top alternatives.
- Some issues are unanswered.
- Release cadence is irregular.

Best for:
- Developers building custom markdown-heavy editors.

Not best for:
- Users needing a complete Notion clone out of the box.
```

---

## 4. Core Scores

RepoRadar should expose transparent scores. The score formulas must be visible in documentation and ideally expandable in the UI.

### 4.1 Fit Score

The Fit Score measures how closely the repository matches the user's intent.

Range:

```text
0.00 = irrelevant
1.00 = exact or near-exact match
```

Suggested formula:

```text
Fit Score =
  0.40 semantic_similarity
+ 0.20 explicit_feature_match
+ 0.15 language_framework_match
+ 0.10 package_manifest_match
+ 0.10 constraint_satisfaction
+ 0.05 repository_type_match
```

#### Components

##### semantic_similarity

Measures vector similarity between the user's intent and repository evidence.

Evidence sources:

- Repository description.
- README.
- Topics.
- Package metadata.
- Docs index.
- Examples folder names.
- Selected config/package files.

##### explicit_feature_match

Checks whether the repo directly mentions required features.

Example:

User asks for:

```text
local-first markdown editor
```

Positive evidence:

```text
README contains "markdown"
README contains "collaboration"
README contains "local-first"
package.json contains editor-related dependencies
topics include "editor", "markdown", "wysiwyg"
```

##### language_framework_match

Checks required language/framework compatibility.

Example:

```text
language: TypeScript
framework: Next.js
runtime: Bun
```

##### package_manifest_match

Inspects files such as:

```text
package.json
pyproject.toml
Cargo.toml
go.mod
requirements.txt
pom.xml
build.gradle
```

This helps distinguish real libraries from random demos.

##### constraint_satisfaction

Checks constraints like:

```text
license must be MIT/Apache/BSD
must have docs
must be active in last 6 months
must be usable as a library
must not be archived
```

##### repository_type_match

Classifies repository type:

```text
library
framework
CLI
SaaS app
template
demo
research prototype
course/tutorial
awesome-list
plugin
extension
dataset
```

If the user wants a library, an awesome-list should rank low even if semantically similar.

---

### 4.2 Future Score

The Future Score estimates whether the repository is likely to stay useful.

Range:

```text
0.00 = dead / risky
1.00 = highly maintained and healthy
```

Suggested formula:

```text
Future Score =
  0.20 recent_activity
+ 0.15 release_cadence
+ 0.15 issue_pr_health
+ 0.15 contributor_health
+ 0.15 star_velocity
+ 0.10 documentation_quality
+ 0.10 ecosystem_signal
- risk_penalties
```

#### Components

##### recent_activity

Signals:

```text
pushed_at
recent commits
recent merged PRs
recent issue comments
recent release tags
```

##### release_cadence

Signals:

```text
number of releases in last 90 days
number of releases in last 365 days
latest release date
semantic versioning consistency
changelog presence
```

##### issue_pr_health

Signals:

```text
open issue count
closed issue count
recent issue activity
open PR count
merged PR count
stale issue ratio
maintainer response rate
```

##### contributor_health

Signals:

```text
number of contributors
recent active contributors
single-maintainer risk
organization-owned vs personal repo
bus factor estimate
```

##### star_velocity

Signals:

```text
current stars
stars gained in last 7/30/90 days
star growth slope
star growth acceleration
```

For MVP, star velocity may be approximated or lazily loaded because full stargazer history can be expensive.

##### documentation_quality

Signals:

```text
README length and structure
installation section exists
quickstart exists
examples exist
API docs exist
docs folder exists
website link exists
screenshots/demo exists
```

##### ecosystem_signal

Signals:

```text
package downloads if available
npm/PyPI/crates.io package exists
dependents count if available
mentions in topics
fork activity
template usage
```

##### risk_penalties

Penalize:

```text
archived repo
deprecated notice
no license
no README
no commits in 12 months
no releases ever
high open-issue stagnation
unmerged PR backlog
single maintainer with no recent activity
security warnings if available
```

---

### 4.3 Underrated Score

The Underrated Score helps discover smaller projects that may be valuable despite low stars.

Suggested formula:

```text
Underrated Score =
  high_fit_score
+ high_future_score
+ high_docs_quality
+ recent_growth
- popularity_saturation
```

Intuition:

```text
A repo with 500 stars, excellent docs, high fit, and strong activity may be more interesting than a 60k-star repo that is broadly popular but not exactly relevant.
```

The UI should include an "Underrated Matches" section.

---

## 5. AI Model Strategy

RepoRadar should not use an expensive frontier model for every repository. Cost-effectiveness is a core design requirement.

### Default Analysis Model

Use:

```text
deepseek-v4-flash
```

Default mode:

```text
non-thinking mode
JSON output enabled
temperature: 0.1 to 0.3
top_p: conservative
```

Why:

- Very cheap compared to most frontier models.
- Fast enough for interactive analysis.
- Supports large context.
- Supports structured JSON output.
- Good for summarization, evidence extraction, classification, and short comparative analysis.
- Good enough when deterministic scoring handles most numerical ranking.

### Model Responsibilities

The model should do:

```text
query intent extraction
query expansion
repository type classification
feature evidence extraction
README summarization
risk explanation
final comparison prose
```

The model should not do:

```text
raw GitHub search
star counting
commit counting
issue counting
final numerical score without formula
unverified factual claims
```

Numerical scores must be computed mostly by code.

### Required Model Output Shape

All model calls must return strict JSON.

Example:

```json
{
  "repo_type": "library",
  "intent_match_summary": "This repository is a TypeScript editor framework with markdown support.",
  "matched_features": [
    {
      "feature": "markdown support",
      "evidence": "README mentions markdown parser and markdown shortcuts.",
      "confidence": 0.92
    }
  ],
  "missing_features": [
    {
      "feature": "local-first sync",
      "reason": "No explicit local-first or offline sync evidence found.",
      "confidence": 0.74
    }
  ],
  "risks": [
    {
      "risk": "release cadence unclear",
      "evidence": "No recent release tags found.",
      "severity": "medium"
    }
  ],
  "summary": "Good candidate for markdown editor use cases, but local-first support is not clearly proven."
}
```

### Cost Control Rules

1. Never analyze more than the top 20 candidate repositories with an LLM by default.
2. Never send full repository source code to the LLM in MVP.
3. Truncate README content using structured chunking.
4. Cache every model result by:
   - repo full name
   - repo pushed_at
   - README hash
   - query intent hash
5. Use deterministic filters before model calls.
6. Use embeddings before LLM calls.
7. Use model only for explanation and evidence extraction, not brute-force ranking.
8. Provide a `NO_LLM_MODE=true` option for fully deterministic local testing.

---

## 6. Data Sources

### Required Data Sources

#### GitHub REST API

Use for:

```text
repository metadata
README
languages
commits
releases
issues
pull requests
contributors
topics
stargazers
```

#### GitHub GraphQL API

Use for batched metadata when possible.

Useful for:

```text
repo fields
stars
forks
watchers
issues
PR counts
license
default branch
repository owner
```

GraphQL should be preferred when it reduces API round trips.

#### Local Cache Database

Use PostgreSQL locally and on Railway.

Tables:

```text
repos
repo_snapshots
repo_readmes
repo_embeddings
search_queries
search_results
repo_scores
model_analyses
star_snapshots
release_snapshots
issue_snapshots
```

### Optional Later Data Sources

```text
GH Archive
ecosyste.ms
npm registry
PyPI
crates.io
Docker Hub
Hugging Face
OpenCollective
Libraries.io-style package metadata
```

Do not add these in Stage 1 unless needed.

---

## 7. System Architecture

### Recommended Stack

```text
Frontend:
  Next.js
  TypeScript
  Tailwind CSS
  shadcn/ui
  Recharts
  TanStack Query

Backend:
  Next.js API routes for MVP
  or FastAPI if Python-heavy scoring is preferred

Database:
  PostgreSQL
  pgvector

Queue:
  Stage 1: simple database job table
  Stage 2+: BullMQ + Redis or Railway cron jobs

AI:
  DeepSeek-V4-Flash as default model
  local embedding model or API-based embeddings

Deployment:
  local Docker Compose for testing
  Railway for production
```

### Alternative Stack

If implementation speed matters more than perfect separation:

```text
Next.js full-stack app
Postgres
Prisma
pgvector
GitHub Octokit
DeepSeek API client
Recharts
Railway
```

This is probably the best MVP stack.

---

## 8. Main Services

### 8.1 Query Service

Responsibilities:

```text
receive user prompt
normalize prompt
extract constraints
generate search queries
create search session
return session ID
```

### 8.2 Candidate Search Service

Responsibilities:

```text
call GitHub Search API
run multiple search variants
deduplicate repositories
apply basic filters
store candidate list
```

Search variants:

```text
keyword query
topic query
language-filtered query
recently-updated query
low-star discovery query
README query
alternative-term query
```

### 8.3 Repository Enrichment Service

Responsibilities:

```text
fetch repo metadata
fetch README
fetch package manifests
fetch releases
fetch issues/PR counts
fetch contributor data
fetch star snapshots if needed
```

### 8.4 Embedding Service

Responsibilities:

```text
create embedding for user intent
create embedding for repository evidence
store vectors in pgvector
compute semantic similarity
```

### 8.5 Scoring Service

Responsibilities:

```text
calculate Fit Score
calculate Future Score
calculate Underrated Score
calculate risk penalties
normalize scores
store score breakdown
```

### 8.6 Model Analysis Service

Responsibilities:

```text
call DeepSeek-V4-Flash
extract feature evidence
classify repo type
summarize why repo matches
summarize missing features
produce risks
produce final comparison
```

### 8.7 Visualization Service

Responsibilities:

```text
prepare chart data
prepare repo cards
prepare comparison tables
prepare star trend
prepare commit/release trend
```

---

## 9. Database Schema Draft

### repos

```sql
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id BIGINT UNIQUE NOT NULL,
  full_name TEXT UNIQUE NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  html_url TEXT NOT NULL,
  description TEXT,
  primary_language TEXT,
  license_spdx TEXT,
  topics TEXT[],
  is_archived BOOLEAN DEFAULT FALSE,
  is_fork BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  pushed_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now()
);
```

### repo_snapshots

```sql
CREATE TABLE repo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  stars INTEGER,
  forks INTEGER,
  watchers INTEGER,
  open_issues INTEGER,
  subscribers INTEGER,
  network_count INTEGER,
  fetched_at TIMESTAMPTZ DEFAULT now()
);
```

### repo_readmes

```sql
CREATE TABLE repo_readmes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  content TEXT,
  content_hash TEXT,
  truncated_content TEXT,
  fetched_at TIMESTAMPTZ DEFAULT now()
);
```

### repo_embeddings

```sql
CREATE TABLE repo_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  embedding VECTOR(384),
  source_type TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### search_queries

```sql
CREATE TABLE search_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_prompt TEXT NOT NULL,
  normalized_prompt TEXT,
  extracted_constraints JSONB,
  intent_embedding VECTOR(384),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### search_results

```sql
CREATE TABLE search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_query_id UUID REFERENCES search_queries(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  rank INTEGER,
  fit_score NUMERIC,
  future_score NUMERIC,
  underrated_score NUMERIC,
  total_score NUMERIC,
  score_breakdown JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### model_analyses

```sql
CREATE TABLE model_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  search_query_id UUID REFERENCES search_queries(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 10. API Design

### POST /api/search

Starts a search session.

Request:

```json
{
  "prompt": "Find a maintained TypeScript markdown editor library",
  "filters": {
    "language": "TypeScript",
    "license": ["MIT", "Apache-2.0"],
    "includeSmallProjects": true,
    "minFutureScore": 0.5
  }
}
```

Response:

```json
{
  "searchId": "uuid",
  "status": "queued"
}
```

### GET /api/search/:id

Returns current search status and partial/final results.

Response:

```json
{
  "searchId": "uuid",
  "status": "completed",
  "results": [
    {
      "repo": {
        "fullName": "owner/name",
        "url": "https://github.com/owner/name",
        "description": "...",
        "language": "TypeScript",
        "license": "MIT"
      },
      "scores": {
        "fit": 0.91,
        "future": 0.84,
        "underrated": 0.76,
        "total": 0.88
      },
      "analysis": {
        "summary": "...",
        "matchedFeatures": [],
        "missingFeatures": [],
        "risks": []
      },
      "metrics": {
        "stars": 1200,
        "forks": 80,
        "openIssues": 24,
        "pushedAt": "2026-05-01T00:00:00Z"
      }
    }
  ]
}
```

### GET /api/repo/:owner/:name

Returns detailed repository report.

### GET /api/repo/:owner/:name/trends

Returns chart data.

### POST /api/compare

Compares selected repositories.

---

## 11. UI Requirements

### Search Page

Components:

```text
large prompt input
advanced filters drawer
search button
example queries
loading/progress state
```

### Results Page

Components:

```text
ranked repo cards
score badges
score breakdown popover
sort controls
filter controls
underrated matches section
comparison drawer
```

### Repo Card

Must show:

```text
repo name
description
GitHub link
Fit Score
Future Score
Underrated Score
stars
forks
license
primary language
last pushed date
created date
risk badges
short model-generated explanation
```

### Repo Detail Page

Must show:

```text
summary
why it matches
missing features
risk analysis
score breakdown
README evidence snippets
star trend chart
commit/release trend chart
issue/PR health section
similar repositories
```

### Visualization

Use Recharts.

Charts:

```text
star trend line chart
commit activity bar chart
release cadence timeline
score radar chart
issue/PR health badges
```

---

## 12. Local Development

### Local Commands

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Optional Docker:

```bash
docker compose up -d
pnpm dev
```

---

## 13. Deployment Requirements

RepoRadar should deploy to Railway.

Railway services:

```text
Web service:
  Next.js app

Database:
  PostgreSQL with pgvector

Optional worker:
  background enrichment worker

Optional Redis:
  only needed if BullMQ is used
```
---

## 14. Engineering Principles

### Principle 1: Deterministic First, AI Second

Scores should be computed by code whenever possible.

The model is for:

```text
language understanding
evidence extraction
classification
summarization
comparison prose
```

The model is not the source of truth for raw metrics.

### Principle 2: Evidence-Grounded Output

Every explanation should be traceable to fetched repository evidence.

Bad:

```text
This repo is popular and reliable.
```

Good:

```text
This repo has 4 releases in the last 90 days, was pushed 3 days ago, has MIT license, and its README includes an installation section and API examples.
```

### Principle 3: Small Repos Must Have a Fair Chance

Do not sort primarily by stars.

Always include:

```text
Best Overall
Best Maintained
Best Small/Underrated
Best Documentation
Lowest Risk
```

### Principle 4: Cache Everything

Cache:

```text
GitHub search results
repo metadata
README content
embeddings
model analyses
score breakdowns
chart data
```

### Principle 5: Build for Self-Hosting

Because RepoRadar is open source, users should be able to run it locally with their own API keys.

---

## 15. MVP Definition

A successful MVP should:

1. Accept a natural-language repo search query.
2. Generate candidate repositories from GitHub.
3. Enrich candidates with metadata and README.
4. Compute Fit Score and Future Score.
5. Use DeepSeek-V4-Flash to produce short evidence-grounded explanations.
6. Display ranked results in a clean UI.
7. Cache results in Postgres.
8. Run locally.
9. Deploy to Railway.

A successful MVP does not need:

```text
full GitHub indexing
perfect star history
browser extension
real-time package download statistics
multi-provider package ecosystem analysis
complex account system
paid subscriptions
```

---

## 16. Future Expansion

Possible future features:

```text
browser extension for GitHub repo pages
CLI: npx reporadar "query"
GitHub Action for dependency evaluation
public API
repo comparison reports
OSS ecosystem maps
alerts for abandoned dependencies
package registry integration
Hacker News / Reddit / newsletter launch pages
self-hosted enterprise mode
```

---

## 17. Success Metrics

Technical metrics:

```text
search latency under 15 seconds for cached/light queries
search latency under 60 seconds for fresh deep queries
LLM cost below $0.01 per normal search
GitHub API calls below safe rate limits
result relevance acceptable for top 5
```

Product metrics:

```text
GitHub stars
demo searches completed
returning users
shared search result pages
CLI installs if added
issues/PRs from external contributors
mentions in developer communities
```

Open-source credibility metrics:

```text
clear README
public roadmap
issues labeled good-first-issue
contribution guide
changelog
tagged releases
working local setup
Docker/Railway deploy instructions
transparent scoring formulas
