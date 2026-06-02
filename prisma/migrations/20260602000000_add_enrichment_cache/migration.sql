-- Migration: add repo_enrichments and search_candidate_caches tables.
-- These models were added to the Prisma schema after the 0_init baseline
-- but were only applied locally via `prisma db push`.

-- CreateTable
CREATE TABLE IF NOT EXISTS "repo_enrichments" (
    "id" UUID NOT NULL,
    "repo_id" UUID NOT NULL,
    "evidence_json" JSONB NOT NULL,
    "enriched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "search_candidate_caches" (
    "id" UUID NOT NULL,
    "query_hash" TEXT NOT NULL,
    "candidates_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_candidate_caches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "repo_enrichments_repo_id_key" ON "repo_enrichments"("repo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "repo_enrichments_enriched_at_idx" ON "repo_enrichments"("enriched_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "search_candidate_caches_query_hash_key" ON "search_candidate_caches"("query_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "search_candidate_caches_created_at_idx" ON "search_candidate_caches"("created_at");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'repo_enrichments_repo_id_fkey'
    ) THEN
        ALTER TABLE "repo_enrichments"
        ADD CONSTRAINT "repo_enrichments_repo_id_fkey"
        FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
