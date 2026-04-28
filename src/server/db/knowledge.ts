import "server-only";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type KnowledgeChunk,
  type KnowledgeSource,
  type SourceStatus,
  type SourceType,
} from "@prisma/client";
import { prisma } from "./client";
import type { Chunk } from "@/server/knowledge/chunker";

/**
 * Phase-3 DB helper layer. All app code (Server Actions, workers) reaches
 * KnowledgeSource / KnowledgeChunk through this module — never raw Prisma
 * in pages or workers, per CLAUDE.md §3.
 *
 * Vector and tsvector columns are accessed via raw SQL (`$queryRaw` /
 * `$executeRaw`), since Prisma can't bind `Unsupported(...)` columns.
 * tenantId values are always parameterized via Prisma.sql tagged
 * templates — never string-concatenated.
 */

export type SourceLogLevel = "info" | "ok" | "err";
export type SourceLogEntry = {
  ts: string;
  level: SourceLogLevel;
  text: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Source CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createSource(args: {
  tenantId: string;
  type: SourceType;
  name: string;
  sourceUrl: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<{ id: string }> {
  return prisma.knowledgeSource.create({
    data: {
      tenantId: args.tenantId,
      type: args.type,
      name: args.name,
      sourceUrl: args.sourceUrl,
      metadata: args.metadata ?? {},
    },
    select: { id: true },
  });
}

export async function getSource(args: {
  tenantId: string;
  sourceId: string;
}): Promise<KnowledgeSource | null> {
  return prisma.knowledgeSource.findFirst({
    where: { id: args.sourceId, tenantId: args.tenantId },
  });
}

/**
 * Worker-side fetch: doesn't take tenantId because the worker trusts the
 * job payload (which was minted by a Server Action that already enforced
 * tenancy). Use getSource() from web code, getSourceUnscoped() from workers.
 */
export async function getSourceUnscoped(sourceId: string): Promise<KnowledgeSource | null> {
  return prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
}

export type SourceSummary = {
  id: string;
  type: SourceType;
  name: string;
  sourceUrl: string | null;
  status: SourceStatus;
  error: string | null;
  progress: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  lastIngestedAt: Date | null;
  createdAt: Date;
  chunkCount: number;
};

export async function listSourcesForTenant(tenantId: string): Promise<SourceSummary[]> {
  // Single SQL roundtrip: pull source rows joined with chunk counts so the UI
  // doesn't fan out N+1 count queries when rendering the table.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      type: SourceType;
      name: string;
      sourceUrl: string | null;
      status: SourceStatus;
      error: string | null;
      progress: Prisma.JsonValue;
      metadata: Prisma.JsonValue;
      lastIngestedAt: Date | null;
      createdAt: Date;
      chunkCount: bigint;
    }>
  >`
    SELECT s."id",
           s."type",
           s."name",
           s."sourceUrl",
           s."status",
           s."error",
           s."progress",
           s."metadata",
           s."lastIngestedAt",
           s."createdAt",
           COALESCE(c.cnt, 0) AS "chunkCount"
      FROM "KnowledgeSource" s
      LEFT JOIN (
        SELECT "sourceId", COUNT(*)::bigint AS cnt
          FROM "KnowledgeChunk"
         GROUP BY "sourceId"
      ) c ON c."sourceId" = s."id"
     WHERE s."tenantId" = ${tenantId}
     ORDER BY s."createdAt" DESC
  `;
  return rows.map((r) => ({
    ...r,
    chunkCount: Number(r.chunkCount),
  }));
}

export async function deleteSource(args: {
  tenantId: string;
  sourceId: string;
}): Promise<void> {
  // Tenant-scoped delete: deleteMany returns count; ignored.
  await prisma.knowledgeSource.deleteMany({
    where: { id: args.sourceId, tenantId: args.tenantId },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Source status / progress / log
// ─────────────────────────────────────────────────────────────────────────────

export async function updateSourceStatus(args: {
  sourceId: string;
  status?: SourceStatus;
  error?: string | null;
  progress?: Prisma.InputJsonValue;
}): Promise<void> {
  const data: Prisma.KnowledgeSourceUpdateInput = {};
  if (args.status !== undefined) data.status = args.status;
  if (args.error !== undefined) data.error = args.error;
  if (args.progress !== undefined) data.progress = args.progress;
  if (Object.keys(data).length === 0) return;
  await prisma.knowledgeSource.update({ where: { id: args.sourceId }, data });
}

/**
 * Atomic counter increment inside the JSON `progress` field. Embed jobs
 * run concurrently for a single source, so chunksEmbedded must be bumped
 * server-side or counts will collide.
 */
export async function incrementSourceProgressEmbedded(args: {
  sourceId: string;
  delta: number;
}): Promise<void> {
  if (args.delta === 0) return;
  await prisma.$executeRaw`
    UPDATE "KnowledgeSource"
       SET "progress" = jsonb_set(
         COALESCE("progress", '{}'::jsonb),
         '{chunksEmbedded}',
         to_jsonb(
           COALESCE(("progress"->>'chunksEmbedded')::int, 0) + ${args.delta}::int
         )
       )
     WHERE "id" = ${args.sourceId}
  `;
}

/**
 * Set a flag on metadata indicating the tenant has crossed the soft chunk cap.
 * Surfaces as a banner in the UI.
 */
export async function flagSoftCapReached(sourceId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "KnowledgeSource"
       SET "metadata" = jsonb_set(
         COALESCE("metadata", '{}'::jsonb),
         '{softCapReached}',
         'true'::jsonb
       )
     WHERE "id" = ${sourceId}
  `;
}

/**
 * Atomic JSON array push capped at 50 entries. Concatenates the new entry
 * onto metadata.log, then re-aggregates only the most recent 50 items —
 * all in a single UPDATE so concurrent appends don't lose entries.
 */
export async function appendSourceLog(args: {
  sourceId: string;
  level: SourceLogLevel;
  text: string;
}): Promise<void> {
  const entry: SourceLogEntry = {
    ts: new Date().toISOString(),
    level: args.level,
    text: args.text,
  };
  const entryJson = JSON.stringify([entry]);
  await prisma.$executeRaw`
    UPDATE "KnowledgeSource"
       SET "metadata" = jsonb_set(
         COALESCE("metadata", '{}'::jsonb),
         '{log}',
         COALESCE((
           SELECT jsonb_agg(item ORDER BY ord)
             FROM (
               SELECT item, ord
                 FROM jsonb_array_elements(
                   COALESCE("metadata"->'log', '[]'::jsonb) || ${entryJson}::jsonb
                 ) WITH ORDINALITY AS t(item, ord)
                ORDER BY ord DESC
                LIMIT 50
             ) sub
         ), '[]'::jsonb)
       )
     WHERE "id" = ${args.sourceId}
  `;
}

/**
 * Atomic READY transition. Per the project lead's blocking revision:
 * a single UPDATE with a NOT EXISTS guard, never a fetch-then-update.
 * Returns true iff the row flipped.
 */
export async function maybeMarkSourceReady(sourceId: string): Promise<boolean> {
  const affected = await prisma.$executeRaw`
    UPDATE "KnowledgeSource"
       SET "status" = 'READY',
           "lastIngestedAt" = NOW(),
           "error" = NULL
     WHERE "id" = ${sourceId}
       AND "status" = 'PROCESSING'
       AND NOT EXISTS (
         SELECT 1 FROM "KnowledgeChunk"
          WHERE "sourceId" = ${sourceId}
            AND "embedding" IS NULL
       )
  `;
  return affected > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunk CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert chunks with pre-generated UUID ids and no embeddings yet. IDs are
 * pre-generated client-side so the worker can immediately enqueue embed
 * batches against them without a follow-up SELECT.
 */
export async function insertChunksWithoutEmbeddings(args: {
  tenantId: string;
  sourceId: string;
  chunks: Chunk[];
}): Promise<{ chunkIds: string[] }> {
  if (args.chunks.length === 0) return { chunkIds: [] };
  const data = args.chunks.map((c) => ({
    id: randomUUID(),
    tenantId: args.tenantId,
    sourceId: args.sourceId,
    content: c.content,
    tokenCount: c.tokenCount,
    metadata: c.metadata as unknown as Prisma.InputJsonValue,
  }));
  await prisma.knowledgeChunk.createMany({ data });
  return { chunkIds: data.map((d) => d.id) };
}

/**
 * Attach embeddings to a batch of chunks via a single UPDATE … FROM (VALUES …)
 * statement. Vector literals are formatted as pgvector's text form — `[a,b,c]`
 * — and cast to `vector` server-side.
 */
export async function attachEmbeddings(args: {
  chunkIds: string[];
  vectors: number[][];
}): Promise<void> {
  if (args.chunkIds.length !== args.vectors.length) {
    throw new Error("chunkIds.length !== vectors.length");
  }
  if (args.chunkIds.length === 0) return;
  const rows = args.chunkIds.map((id, i) => {
    const literal = "[" + args.vectors[i]!.join(",") + "]";
    return Prisma.sql`(${id}, ${literal}::vector)`;
  });
  await prisma.$executeRaw`
    UPDATE "KnowledgeChunk" AS k
       SET "embedding" = u.v
      FROM (VALUES ${Prisma.join(rows)}) AS u(id, v)
     WHERE k."id" = u.id
  `;
}

/** Chunks (without embedding column, since Prisma can't read vector). */
export async function listChunksForSource(args: {
  tenantId: string;
  sourceId: string;
  limit?: number;
}): Promise<KnowledgeChunk[]> {
  return prisma.knowledgeChunk.findMany({
    where: { sourceId: args.sourceId, tenantId: args.tenantId },
    orderBy: { createdAt: "asc" },
    take: args.limit,
  });
}

export async function listUnembeddedChunkIdsForSource(sourceId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "KnowledgeChunk"
     WHERE "sourceId" = ${sourceId}
       AND "embedding" IS NULL
     ORDER BY "createdAt" ASC
  `;
  return rows.map((r) => r.id);
}

export async function chunkExistsForSource(sourceId: string): Promise<boolean> {
  const found = await prisma.knowledgeChunk.findFirst({
    where: { sourceId },
    select: { id: true },
  });
  return found !== null;
}

export async function deleteChunksForSource(sourceId: string): Promise<void> {
  await prisma.knowledgeChunk.deleteMany({ where: { sourceId } });
}

export async function countTenantChunks(tenantId: string): Promise<number> {
  return prisma.knowledgeChunk.count({ where: { tenantId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunk fetching for the embed worker — pulls only chunks that still need
// an embedding, intersected with a candidate ID list.
// ─────────────────────────────────────────────────────────────────────────────

export type ChunkContent = { id: string; content: string };

export async function listUnembeddedChunksByIds(args: {
  chunkIds: string[];
}): Promise<ChunkContent[]> {
  if (args.chunkIds.length === 0) return [];
  return prisma.$queryRaw<ChunkContent[]>`
    SELECT "id", "content" FROM "KnowledgeChunk"
     WHERE "id" IN (${Prisma.join(args.chunkIds)})
       AND "embedding" IS NULL
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval (Phase 3, step 8)
// ─────────────────────────────────────────────────────────────────────────────

import type { SourceType as _SourceType } from "@prisma/client";
import { HNSW_EF_SEARCH } from "@/server/knowledge/limits";

export type RawSearchHit = {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  sourceType: _SourceType;
  content: string;
  metadata: Prisma.JsonValue;
  score: number;
};

/**
 * Cosine-similarity vector search, scoped to one tenant. Wrapped in a
 * transaction so we can `SET LOCAL hnsw.ef_search` first — the default
 * ef_search of 40 returns too few candidates after the tenantId filter
 * to fill top-K reliably (per blocking revision #6).
 *
 * The query vector is encoded as a pgvector literal (`[a,b,c]`) and
 * cast server-side. tenantId is parameterized via Prisma.sql, never
 * string-concatenated (per project lead's nit).
 */
export async function vectorSearch(args: {
  tenantId: string;
  queryVector: number[];
  limit: number;
}): Promise<RawSearchHit[]> {
  const literal = "[" + args.queryVector.join(",") + "]";
  return prisma.$transaction(async (tx) => {
    // SET parameters can't be bound, only literals; the value here is a
    // constant from limits.ts, never user-supplied.
    await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`);
    return tx.$queryRaw<RawSearchHit[]>`
      SELECT k."id"        AS "chunkId",
             k."sourceId"  AS "sourceId",
             s."name"      AS "sourceName",
             s."type"      AS "sourceType",
             k."content"   AS "content",
             k."metadata"  AS "metadata",
             1 - (k."embedding" <=> ${literal}::vector) AS "score"
        FROM "KnowledgeChunk" k
        JOIN "KnowledgeSource" s ON s."id" = k."sourceId"
       WHERE k."tenantId" = ${args.tenantId}
         AND k."embedding" IS NOT NULL
       ORDER BY k."embedding" <=> ${literal}::vector ASC
       LIMIT ${args.limit}
    `;
  });
}

/**
 * Lexical (full-text) search via plainto_tsquery on the `simple`
 * configuration — same one as the GENERATED searchVector column. Free-form
 * user queries are accepted as-is; plainto_tsquery handles operator escaping.
 */
export async function lexicalSearch(args: {
  tenantId: string;
  query: string;
  limit: number;
}): Promise<RawSearchHit[]> {
  return prisma.$queryRaw<RawSearchHit[]>`
    SELECT k."id"        AS "chunkId",
           k."sourceId"  AS "sourceId",
           s."name"      AS "sourceName",
           s."type"      AS "sourceType",
           k."content"   AS "content",
           k."metadata"  AS "metadata",
           ts_rank(k."searchVector", plainto_tsquery('simple', ${args.query})) AS "score"
      FROM "KnowledgeChunk" k
      JOIN "KnowledgeSource" s ON s."id" = k."sourceId"
     WHERE k."tenantId" = ${args.tenantId}
       AND k."searchVector" @@ plainto_tsquery('simple', ${args.query})
     ORDER BY "score" DESC
     LIMIT ${args.limit}
  `;
}
