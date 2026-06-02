# RepoRadar production image
# Railway builds this automatically when the repo is linked.
# Set all secrets (DATABASE_URL, GITHUB_TOKEN, OPENROUTER_API_KEY, etc.)
# in the Railway dashboard — never commit them to the repo.

# Node 22 LTS is required for pnpm 9+ (Corepack resolves the version pinned in
# package.json "packageManager": "pnpm@9.15.4"). All app dependencies support
# Node 22; local development on Node 20 also works with the pinned pnpm 9.
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ── dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# prisma generate reads the schema and generates TS types — it does NOT
# require DATABASE_URL (no DB connection at build time). DATABASE_URL is only
# needed at runtime for `prisma migrate deploy` in the CMD below.
RUN pnpm exec prisma generate && pnpm exec next build --webpack

# ── runtime ───────────────────────────────────────────────────────────────────
FROM base AS run
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Railway injects PORT automatically; default 3000 for local docker runs.
ENV PORT=3000

# Copy the full build output including node_modules so native addons
# (onnxruntime-node, sharp) work without re-compilation.
COPY --from=build /app ./

# Railway uses the PORT env var for routing — EXPOSE is documentation only.
EXPOSE 3000

# Apply any pending DB migrations then start Next.js on Railway's PORT.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec next start -p ${PORT:-3000}"]
