-- Live Data Sources feature (2026-05-06)
--
-- Adds the LiveDataSource model + the sync-tracking fields on KnowledgeItem
-- needed for ERP polling adapters (ODOO is the only adapter today; reserved
-- enum values for SHOPIFY / WOOCOMMERCE / MANUAL_CSV / GOOGLE_SHEETS /
-- WEBHOOK ride forward without further migrations).
--
-- Generated via `prisma migrate diff --script` against the live DB per the
-- Phase 8a recovery path (CLAUDE.md §6 — migrate-dev refused on the Phase
-- 7a checksum drift). Hand-edited to strip the standing list of spurious
-- DROP INDEX lines (PSL can't model HNSW indexes; the diff engine flags
-- them as "extra in DB" on every run) and the spurious
-- ALTER COLUMN "searchVector" SET DEFAULT (PSL can't express the
-- GENERATED ALWAYS expression — applying the diff's DEFAULT clause would
-- break the weighted concat). Apply via `npm run db:migrate:deploy`.

-- CreateEnum
CREATE TYPE "LiveDataSourceType" AS ENUM ('ODOO');

-- CreateEnum
CREATE TYPE "LiveDataSourceStatus" AS ENUM ('PENDING_TEST', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- INTENTIONAL: do not drop KnowledgeChunk_embedding_hnsw — managed via raw SQL
-- INTENTIONAL: do not drop KnowledgeGap_embedding_hnsw — managed via raw SQL
-- INTENTIONAL: do not drop KnowledgeItem_embedding_hnsw — managed via raw SQL
-- INTENTIONAL: do not drop QnaPair_questionEmbedding_hnsw — managed via raw SQL

-- AlterTable
-- INTENTIONAL: ALTER COLUMN "searchVector" SET DEFAULT stripped — the column
-- is GENERATED ALWAYS via raw SQL in 20260430000000_phase8a_typed_knowledge_tables;
-- applying the diff's plain DEFAULT clause would replace the generated
-- expression with a literal default and break weighted-concat indexing.
ALTER TABLE "KnowledgeItem" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "liveDataSourceId" TEXT,
ADD COLUMN     "quantityAvailable" INTEGER,
ADD COLUMN     "quantityOnHand" INTEGER,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LiveDataSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "LiveDataSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "status" "LiveDataSourceStatus" NOT NULL DEFAULT 'PENDING_TEST',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "syncedRecordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveDataSource_tenantId_idx" ON "LiveDataSource"("tenantId");

-- CreateIndex
CREATE INDEX "LiveDataSource_status_idx" ON "LiveDataSource"("status");

-- CreateIndex
CREATE INDEX "KnowledgeItem_liveDataSourceId_idx" ON "KnowledgeItem"("liveDataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItem_tenantId_liveDataSourceId_externalId_key" ON "KnowledgeItem"("tenantId", "liveDataSourceId", "externalId");

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_liveDataSourceId_fkey" FOREIGN KEY ("liveDataSourceId") REFERENCES "LiveDataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDataSource" ADD CONSTRAINT "LiveDataSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
