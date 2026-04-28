-- Phase 6a — WhatsApp routing schema
--
-- Adds Message.providerMessageId for inbound webhook idempotency + outbound
-- delivery-status tracking on non-widget channels (360dialog/Meta WhatsApp,
-- and later IG/FB). Adds the partial unique index on
-- Channel.config->>'phoneNumberId' that the WhatsApp webhook handler uses
-- to resolve the receiving Channel from the inbound payload's phone_number_id.
--
-- INTENTIONAL: do not drop KnowledgeChunk_embedding_hnsw.
-- prisma migrate dev --create-only generates a stray
--   DROP INDEX "KnowledgeChunk_embedding_hnsw";
-- on every run because PSL cannot model HNSW indexes (CLAUDE.md §6, §6's
-- "Prisma migrate dev: drift prompt + DROP INDEX inspection" sub-section).
-- The HNSW index lives in the database — created via raw SQL in
-- 20260427235200_add_knowledge_models — and the verifier
-- scripts/verify-knowledge-schema.mjs asserts it after every migration.
-- The DROP line is stripped here with this comment in its place so a future
-- maintainer doesn't roll the strip back.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "providerMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Message_tenantId_providerMessageId_idx" ON "Message"("tenantId", "providerMessageId");

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 6a raw-SQL: partial unique on Channel.config->>'phoneNumberId'
-- ─────────────────────────────────────────────────────────────────────────────
-- Used by the WhatsApp webhook handler to resolve the receiving Channel from
-- the incoming payload's `phone_number_id` (360dialog forwards Meta-shape
-- payloads on every inbound message and status update). Same pattern as the
-- widget public-key partial unique in 20260428205650_add_channel_models. PSL
-- can't model this — no JSON path indexes, no partial-WHERE by enum value —
-- so it's created via raw SQL appended here.
--
-- Uniqueness scope: one channel per WABA phone-number-id globally. Two
-- tenants cannot register the same phoneNumberId; the WhatsApp connect flow
-- in 6e surfaces the constraint violation as a user-facing error.
--
-- The partial WHERE excludes WIDGET / INSTAGRAM rows and any row where
-- phoneNumberId is unset, keeping the index small and skipping nulls cleanly.
CREATE UNIQUE INDEX "Channel_whatsapp_phoneNumberId_unique"
    ON "Channel" (("config" ->> 'phoneNumberId'))
    WHERE "type" = 'WHATSAPP' AND ("config" ->> 'phoneNumberId') IS NOT NULL;
