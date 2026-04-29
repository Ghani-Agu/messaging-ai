-- Phase 7a corrective migration.
--
-- This migration repairs the live DB after the prior migration
-- `20260429014012_add_meta_routing` accidentally applied with its
-- spurious DROP INDEX line intact. That earlier file was generated
-- by `prisma migrate dev --create-only`, killed at the drift prompt,
-- and then applied by the next `migrate dev` re-run as part of its
-- pre-flight pending-migration apply pass — destructively dropping
-- the HNSW vector index before its DROP INDEX line could be stripped.
--
-- This migration:
--   1. Restores `KnowledgeChunk_embedding_hnsw` with the same
--      definition as the original from
--      20260427235200_add_knowledge_models/migration.sql.
--   2. Adds the two partial unique indexes that the original 7a
--      plan was meant to land — `Channel_messenger_pageId_unique`
--      and `Channel_instagram_igUserId_unique`.
--
-- The MESSENGER enum value is NOT re-added here — it's already on
-- the live DB from the prior (partially-applied) migration and that's
-- the only beneficial side effect of that incident.
--
-- CLAUDE.md §6 will be updated in 7g with the recovery protocol that
-- prevents this class of incident: "after Ctrl+C-ing the drift prompt,
-- inspect prisma/migrations/ for any newly-created directory and
-- strip spurious DROP INDEX lines BEFORE re-running migrate dev (the
-- pre-flight pending-migration apply pass would otherwise apply the
-- flawed file destructively). Use db:migrate:deploy after correction."

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restore the HNSW vector index on KnowledgeChunk.embedding.
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical to the original definition in
-- 20260427235200_add_knowledge_models/migration.sql lines 77-80:
-- same algorithm (hnsw), same opclass (vector_cosine_ops), same
-- m / ef_construction defaults. ef_search remains a per-query
-- SET LOCAL in src/server/knowledge/retriever.ts.
CREATE INDEX "KnowledgeChunk_embedding_hnsw"
    ON "KnowledgeChunk"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Phase 7a raw-SQL: partial unique on Channel.config->>'pageId' for MESSENGER.
-- ─────────────────────────────────────────────────────────────────────────────
-- Used by the Meta webhook handler to resolve MESSENGER channels from
-- entry[].messaging[].recipient.id (the Page ID). Same pattern as the
-- Phase 6a partial unique on phoneNumberId. PSL can't model this — JSON
-- path indexes + partial-WHERE-by-enum aren't supported.
--
-- Uniqueness scope: one MESSENGER channel per Page globally. Two tenants
-- cannot register the same Page; the connect flow surfaces P2002 as
-- "This Facebook Page is already connected to another workspace."
CREATE UNIQUE INDEX "Channel_messenger_pageId_unique"
    ON "Channel" (("config" ->> 'pageId'))
    WHERE "type" = 'MESSENGER' AND ("config" ->> 'pageId') IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Phase 7a raw-SQL: partial unique on Channel.config->>'igUserId' for INSTAGRAM.
-- ─────────────────────────────────────────────────────────────────────────────
-- Used by the Meta webhook handler to resolve INSTAGRAM channels from
-- entry[].changes[].value (where field='messages') by igUserId — Meta's
-- Instagram Graph API webhook payload identifies the IG account by the
-- Instagram User ID (numeric, ~17 digits).
--
-- Uniqueness scope: one INSTAGRAM channel per IG account globally. The
-- connect flow surfaces P2002 as "This Instagram account is already
-- connected to another workspace."
CREATE UNIQUE INDEX "Channel_instagram_igUserId_unique"
    ON "Channel" (("config" ->> 'igUserId'))
    WHERE "type" = 'INSTAGRAM' AND ("config" ->> 'igUserId') IS NOT NULL;
