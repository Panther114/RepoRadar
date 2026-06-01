-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "repos" (
    "id" UUID NOT NULL,
    "github_id" BIGINT NOT NULL,
    "full_name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "html_url" TEXT NOT NULL,
    "description" TEXT,
    "primary_language" TEXT,
    "license_spdx" TEXT,
    "topics" TEXT[],
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_fork" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "pushed_at" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_snapshots" (
    "id" UUID NOT NULL,
    "repo_id" UUID NOT NULL,
    "stars" INTEGER,
    "forks" INTEGER,
    "watchers" INTEGER,
    "open_issues" INTEGER,
    "subscribers" INTEGER,
    "network_count" INTEGER,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_readmes" (
    "id" UUID NOT NULL,
    "repo_id" UUID NOT NULL,
    "content" TEXT,
    "content_hash" TEXT,
    "truncated_content" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_readmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_embeddings" (
    "id" UUID NOT NULL,
    "repo_id" UUID NOT NULL,
    "embedding" vector(384),
    "source_type" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_queries" (
    "id" UUID NOT NULL,
    "raw_prompt" TEXT NOT NULL,
    "normalized_prompt" TEXT,
    "extracted_constraints" JSONB,
    "intent_hash" TEXT,
    "intent_embedding" vector(384),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_results" (
    "id" UUID NOT NULL,
    "search_query_id" UUID NOT NULL,
    "repo_id" UUID NOT NULL,
    "rank" INTEGER,
    "fit_score" DOUBLE PRECISION,
    "future_score" DOUBLE PRECISION,
    "underrated_score" DOUBLE PRECISION,
    "total_score" DOUBLE PRECISION,
    "score_breakdown" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_analyses" (
    "id" UUID NOT NULL,
    "repo_id" UUID NOT NULL,
    "search_query_id" UUID,
    "model_name" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "output_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_jobs" (
    "id" UUID NOT NULL,
    "search_query_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repos_github_id_key" ON "repos"("github_id");

-- CreateIndex
CREATE UNIQUE INDEX "repos_full_name_key" ON "repos"("full_name");

-- CreateIndex
CREATE INDEX "repo_snapshots_repo_id_idx" ON "repo_snapshots"("repo_id");

-- CreateIndex
CREATE INDEX "repo_readmes_repo_id_idx" ON "repo_readmes"("repo_id");

-- CreateIndex
CREATE INDEX "repo_embeddings_repo_id_idx" ON "repo_embeddings"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_embeddings_repo_id_source_type_key" ON "repo_embeddings"("repo_id", "source_type");

-- CreateIndex
CREATE INDEX "search_results_search_query_id_idx" ON "search_results"("search_query_id");

-- CreateIndex
CREATE INDEX "model_analyses_repo_id_idx" ON "model_analyses"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "model_analyses_input_hash_key" ON "model_analyses"("input_hash");

-- CreateIndex
CREATE INDEX "search_jobs_search_query_id_idx" ON "search_jobs"("search_query_id");

-- AddForeignKey
ALTER TABLE "repo_snapshots" ADD CONSTRAINT "repo_snapshots_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_readmes" ADD CONSTRAINT "repo_readmes_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_embeddings" ADD CONSTRAINT "repo_embeddings_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_search_query_id_fkey" FOREIGN KEY ("search_query_id") REFERENCES "search_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_analyses" ADD CONSTRAINT "model_analyses_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_analyses" ADD CONSTRAINT "model_analyses_search_query_id_fkey" FOREIGN KEY ("search_query_id") REFERENCES "search_queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_search_query_id_fkey" FOREIGN KEY ("search_query_id") REFERENCES "search_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (pgvector): ivfflat cosine index for fast similarity search.
-- Safe to create on an empty table; pgvector picks centroids as rows arrive.
CREATE INDEX IF NOT EXISTS "repo_embeddings_embedding_ivfflat"
    ON "repo_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
