-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('WEBSITE', 'FILE', 'MANUAL');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'ERROR');

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastIngestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "tokenCount" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- searchVector is a Postgres GENERATED column. Prisma's PSL can't express the
-- GENERATED ALWAYS clause, so we add the column manually here. Config 'simple'
-- (no stemming, no stopwords) is required because we mix AR/FR/EN/Darija.
ALTER TABLE "KnowledgeChunk"
    ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;

-- CreateIndex
CREATE INDEX "KnowledgeSource_tenantId_status_idx" ON "KnowledgeSource"("tenantId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeSource_tenantId_createdAt_idx" ON "KnowledgeSource"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tenantId_idx" ON "KnowledgeChunk"("tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk"("sourceId");

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lexical (full-text) index. Required for the lexical half of hybrid retrieval.
CREATE INDEX "KnowledgeChunk_searchVector_gin"
    ON "KnowledgeChunk"
    USING GIN ("searchVector");

-- Vector index. HNSW with cosine distance — chosen over IVFFlat because (a) it
-- needs no training and degrades gracefully as chunks are added per tenant, and
-- (b) Supabase pgvector >= 0.5 supports it natively. m / ef_construction are the
-- pgvector defaults; ef_search is set per-query in retriever.ts to widen the
-- candidate pool after the tenantId filter.
CREATE INDEX "KnowledgeChunk_embedding_hnsw"
    ON "KnowledgeChunk"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
