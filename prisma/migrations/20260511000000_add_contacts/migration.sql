-- Contact model (replaces the Billing placeholder surface).
--
-- Hand-written via `prisma migrate diff --script` per CLAUDE.md §6 — the
-- prior phase-7a corrective migration drifted the recorded checksum, so
-- `migrate dev` won't generate a clean diff. We strip the spurious DROP
-- INDEX lines for `KnowledgeItem_embedding_hnsw` and
-- `QnaPair_questionEmbedding_hnsw` (raw-SQL HNSW indexes that PSL can't
-- model — stripping them is per the standing rule), and we strip the
-- ALTER COLUMN searchVector DEFAULT line (GENERATED column drift; PSL
-- can't model GENERATED ALWAYS so it sees the live state as a "default"
-- mismatch — also intentional, do not apply).
--
-- INTENTIONAL: do not drop KnowledgeItem_embedding_hnsw — managed via raw SQL.
-- INTENTIONAL: do not drop QnaPair_questionEmbedding_hnsw — managed via raw SQL.
-- INTENTIONAL: do not alter KnowledgeItem.searchVector DEFAULT — GENERATED column managed via raw SQL.

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_tenantId_idx" ON "Contact"("tenantId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
