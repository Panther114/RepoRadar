-- CreateTable
CREATE TABLE "site_visitors" (
    "id" UUID NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_path" TEXT,
    "user_agent" TEXT,
    "referrer" TEXT,

    CONSTRAINT "site_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_visitors_visitor_id_key" ON "site_visitors"("visitor_id");

-- CreateIndex
CREATE INDEX "site_visitors_last_seen_at_idx" ON "site_visitors"("last_seen_at");
