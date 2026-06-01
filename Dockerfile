# RepoRadar production image (Stage 4). Build on a normal filesystem (Railway/
# Linux), NOT the exFAT dev drive. Railway can also build this via Nixpacks
# without a Dockerfile — this is provided for portability.

FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- dependencies ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate && pnpm exec next build --webpack

# ---- runtime ----
FROM base AS run
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app ./
EXPOSE 3000
# Apply migrations, then start. Set env vars (DATABASE_URL, OPENROUTER_API_KEY,
# GITHUB_TOKEN, NO_LLM_MODE, ...) in the Railway dashboard.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start"]
