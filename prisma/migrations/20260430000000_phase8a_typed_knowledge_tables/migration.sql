-- Phase 8a — Typed knowledge tables.
--
-- Adds three knowledge-type rails alongside KnowledgeChunk + a gap log:
--   - KnowledgeItem    (Type 2: structured items)
--   - QnaPair          (Type 3: authoritative Q&A pairs)
--   - OperationalFacts (Type 5: tenant-singleton facts)
--   - KnowledgeGap     (gap log for unanswered customer questions)
-- Plus KnowledgeSource.lastVerifiedAt for the freshness signal.
--
-- Generated via `prisma migrate diff --from-schema-datasource ... --script`
-- (read-only diff, no shadow DB / no drift prompt) rather than `migrate dev
-- --create-only` because the historical Phase 7a corrective state still
-- registers as "modified after applied" and migrate-dev would refuse to
-- proceed without a destructive reset (CLAUDE.md §6).
--
-- Three modifications applied to the diff output before this file:
--   1. Stripped the spurious `DROP INDEX "KnowledgeChunk_embedding_hnsw"`
--      line per CLAUDE.md §6 standing rule — Prisma's diff engine emits
--      this on every diff because PSL can't model HNSW; the index is
--      intentional, managed by raw SQL.
--   2. Removed the `"searchVector" tsvector DEFAULT to_tsvector(...)`
--      column line from CREATE TABLE "KnowledgeItem" and replaced with an
--      ALTER TABLE GENERATED ALWAYS clause covering name + brand + sku +
--      description with weighted setweight(). PSL's @default(dbgenerated())
--      is a stub for drift suppression only — same pattern as
--      KnowledgeChunk.searchVector.
--   3. Appended raw-SQL HNSW indexes on the three new vector columns at
--      the bottom. PSL can't model HNSW. Index names added to CLAUDE.md §6
--      strip list:
--        - KnowledgeItem_embedding_hnsw
--        - QnaPair_questionEmbedding_hnsw
--        - KnowledgeGap_embedding_hnsw

-- INTENTIONAL: do not drop KnowledgeChunk_embedding_hnsw — managed via raw SQL
-- (line stripped per CLAUDE.md §6 standing rule).

-- CreateEnum
CREATE TYPE "ItemAvailability" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN');

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "externalId" TEXT,
    "sku" TEXT,
    "brand" TEXT,
    "currency" TEXT,
    "priceCents" INTEGER,
    "availability" "ItemAvailability" NOT NULL DEFAULT 'UNKNOWN',
    "description" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1024),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- searchVector is a Postgres GENERATED column that re-computes whenever
-- name / brand / sku / description change. setweight() ranks fields A>B>C
-- so ts_rank weights name highest, brand and sku next (both 'B' so they
-- tie), description last. Config 'simple' (no stemming, no stopwords) is
-- required because we mix AR/FR/EN/Darija — same reasoning as
-- KnowledgeChunk.searchVector.
--
-- TRADE-OFF: specs JSON is intentionally excluded from the lexical index.
-- A query like "red 256GB laptop" won't lexically hit an item whose color
-- and capacity live only in `specs` — that match comes from embedding
-- similarity (the embed worker concatenates spec values into the embed
-- input, where 'simple'-config tsvector noise from JSON syntax / reserved
-- keys like _template_id can't pollute lexical scoring). To put spec
-- values in lexical too, replace the SQL below with:
--   setweight(to_tsvector('simple',
--     COALESCE(jsonb_path_query_array("specs", '$.*')::text, '')), 'D')
-- which is IMMUTABLE on Postgres 12+ but mixes brace/bracket noise into
-- the index. The current shape favors clean lexical signal over recall
-- on spec-only queries.
ALTER TABLE "KnowledgeItem"
    ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', COALESCE("name", '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE("brand", '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE("sku", '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE("description", '')), 'C')
    ) STORED;

-- CreateTable
CREATE TABLE "QnaPair" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "normalizedQuestion" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT,
    "languageLock" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "questionEmbedding" vector(1024),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QnaPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalFacts" (
    "tenantId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalFacts_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT,
    "question" TEXT NOT NULL,
    "language" TEXT,
    "embedding" vector(1024),
    "clusterKey" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_category_idx" ON "KnowledgeItem"("tenantId", "category");

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_name_idx" ON "KnowledgeItem"("tenantId", "name");

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_createdAt_idx" ON "KnowledgeItem"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeItem_searchVector_gin" ON "KnowledgeItem" USING GIN ("searchVector");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItem_tenantId_externalId_key" ON "KnowledgeItem"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "QnaPair_tenantId_createdAt_idx" ON "QnaPair"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "QnaPair_tenantId_language_idx" ON "QnaPair"("tenantId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "QnaPair_tenantId_normalizedQuestion_key" ON "QnaPair"("tenantId", "normalizedQuestion");

-- CreateIndex
CREATE INDEX "KnowledgeGap_tenantId_resolved_createdAt_idx" ON "KnowledgeGap"("tenantId", "resolved", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeGap_tenantId_clusterKey_idx" ON "KnowledgeGap"("tenantId", "clusterKey");

-- CreateIndex
CREATE INDEX "KnowledgeGap_conversationId_idx" ON "KnowledgeGap"("conversationId");

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnaPair" ADD CONSTRAINT "QnaPair_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalFacts" ADD CONSTRAINT "OperationalFacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vector indexes (HNSW, cosine) — PSL can't model these; raw SQL only.
-- m / ef_construction: pgvector defaults, same as KnowledgeChunk_embedding_hnsw.
-- ef_search is set per-query via `SET LOCAL hnsw.ef_search` in the retriever
-- (src/server/knowledge/limits.ts:HNSW_EF_SEARCH).
-- These index names are in the CLAUDE.md §6 strip list — future
-- `migrate dev --create-only` runs will emit `DROP INDEX` lines for them.
-- Always strip those lines before applying.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX "KnowledgeItem_embedding_hnsw"
    ON "KnowledgeItem"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX "QnaPair_questionEmbedding_hnsw"
    ON "QnaPair"
    USING hnsw ("questionEmbedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX "KnowledgeGap_embedding_hnsw"
    ON "KnowledgeGap"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
