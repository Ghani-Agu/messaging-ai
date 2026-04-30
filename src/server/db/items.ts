import "server-only";
import { z } from "zod";
import {
  Prisma,
  type ItemAvailability,
  type KnowledgeItem,
} from "@prisma/client";
import { prisma } from "./client";
import { enqueueEmbedItems } from "@/server/queue/jobs";

/**
 * KnowledgeItem (Phase 8b — Type 2: structured items).
 *
 * Same Unsupported-vector pattern as KnowledgeChunk: the `embedding` column
 * is read/written via raw SQL because Prisma can't bind `Unsupported(...)`.
 * The lexical column `searchVector` is GENERATED in the DB (raw SQL in the
 * migration) — Prisma never writes to it.
 *
 * Embedding is enqueued (not awaited) by the create / update helpers —
 * `enqueueEmbedItem` is a stub in P8b and routes through the embed worker
 * with a `kind: "item"` discriminator in P8c. List/edit/delete works fully
 * with `embedding IS NULL`; the item just won't surface in semantic search
 * until P8c lands.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Specs (free-form bag with reserved keys)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spec values are flexible — any business can pin whatever fields they need
 * (color, size, weight, technical specs). Reserved keys carry semantics:
 *
 *   _template_id?: string — points to a category form template for future
 *     per-category UI rendering (Gate-1 decision A). Opaque at this layer;
 *     the dashboard form layer reads it to pick a render strategy.
 *
 * Values constrained to JSON-primitive scalars so the embed worker (P8c)
 * can flatten them to text without nested-object surgery.
 */
export const knowledgeItemSpecsSchema = z
  .object({
    _template_id: z.string().trim().min(1).max(80).optional(),
  })
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type KnowledgeItemSpecs = z.infer<typeof knowledgeItemSpecsSchema>;

export const itemAvailabilityValues = [
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "UNKNOWN",
] as const satisfies readonly ItemAvailability[];

export const itemAvailabilitySchema = z.enum(itemAvailabilityValues);

// ─────────────────────────────────────────────────────────────────────────────
// Input schema (Server Action / direct caller validation)
// ─────────────────────────────────────────────────────────────────────────────

export const knowledgeItemInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  category: z.string().trim().min(1).max(80).optional(),
  // Stable external identifier — composite-unique with tenantId. Pass the
  // same value on re-import to dedupe rather than create.
  externalId: z.string().trim().min(1).max(120).optional(),
  sku: z.string().trim().min(1).max(120).optional(),
  brand: z.string().trim().min(1).max(120).optional(),
  // ISO 4217 (DZD/USD/EUR/...). Free-form to allow service-business cases
  // where a price exists but no currency is meaningful.
  currency: z.string().trim().min(1).max(8).optional(),
  // Stored as integer cents — the form/UI presents it as decimal currency.
  priceCents: z.number().int().nonnegative().max(2_000_000_000).optional(),
  availability: itemAvailabilitySchema.default("UNKNOWN"),
  description: z.string().trim().max(4000).optional(),
  specs: knowledgeItemSpecsSchema.default({}),
});
export type KnowledgeItemInput = z.infer<typeof knowledgeItemInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Read shapes
// ─────────────────────────────────────────────────────────────────────────────

export type ItemSummary = {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  sku: string | null;
  currency: string | null;
  priceCents: number | null;
  availability: ItemAvailability;
  hasEmbedding: boolean;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createItem(args: {
  tenantId: string;
  input: KnowledgeItemInput;
}): Promise<{ id: string }> {
  const data = knowledgeItemInputSchema.parse(args.input);
  const created = await prisma.knowledgeItem.create({
    data: {
      tenantId: args.tenantId,
      name: data.name,
      category: data.category ?? null,
      externalId: data.externalId ?? null,
      sku: data.sku ?? null,
      brand: data.brand ?? null,
      currency: data.currency ?? null,
      priceCents: data.priceCents ?? null,
      availability: data.availability,
      description: data.description ?? null,
      specs: data.specs as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  // Phase 8c: enqueue embedding so the new item shows up in semantic search.
  // Single-item batches are fine; the embed worker batches consecutive jobs
  // up to EMBED_BATCH_SIZE on the provider call internally.
  await enqueueEmbedItems({ tenantId: args.tenantId, itemIds: [created.id] });
  return created;
}

export async function updateItem(args: {
  tenantId: string;
  itemId: string;
  input: KnowledgeItemInput;
}): Promise<void> {
  const data = knowledgeItemInputSchema.parse(args.input);
  const result = await prisma.knowledgeItem.updateMany({
    where: { id: args.itemId, tenantId: args.tenantId },
    data: {
      name: data.name,
      category: data.category ?? null,
      externalId: data.externalId ?? null,
      sku: data.sku ?? null,
      brand: data.brand ?? null,
      currency: data.currency ?? null,
      priceCents: data.priceCents ?? null,
      availability: data.availability,
      description: data.description ?? null,
      specs: data.specs as Prisma.InputJsonValue,
    },
  });
  if (result.count === 0) throw new Error("Item not found");
  // Phase 8c: clear the existing embedding so the worker re-embeds with
  // the updated text. Without this the embed worker's idempotency guard
  // (`AND embedding IS NULL`) would short-circuit and the vector would
  // stay stale.
  await prisma.$executeRaw`
    UPDATE "KnowledgeItem"
       SET "embedding" = NULL
     WHERE "id" = ${args.itemId}
       AND "tenantId" = ${args.tenantId}
  `;
  await enqueueEmbedItems({ tenantId: args.tenantId, itemIds: [args.itemId] });
}

export async function deleteItem(args: {
  tenantId: string;
  itemId: string;
}): Promise<void> {
  await prisma.knowledgeItem.deleteMany({
    where: { id: args.itemId, tenantId: args.tenantId },
  });
}

export async function getItem(args: {
  tenantId: string;
  itemId: string;
}): Promise<KnowledgeItem | null> {
  return prisma.knowledgeItem.findFirst({
    where: { id: args.itemId, tenantId: args.tenantId },
  });
}

export async function listItemsForTenant(args: {
  tenantId: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<ItemSummary[]> {
  const where: Prisma.KnowledgeItemWhereInput = { tenantId: args.tenantId };
  if (args.category) where.category = args.category;
  if (args.search?.trim()) {
    const q = args.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.knowledgeItem.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 50,
    skip: args.offset ?? 0,
    select: {
      id: true,
      name: true,
      category: true,
      brand: true,
      sku: true,
      currency: true,
      priceCents: true,
      availability: true,
      lastVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (rows.length === 0) return [];
  // Embedding column is Unsupported in Prisma — pull a presence boolean
  // via a single raw aux query rather than per-row.
  const ids = rows.map((r) => r.id);
  const embRows = await prisma.$queryRaw<Array<{ id: string; has: boolean }>>`
    SELECT "id", ("embedding" IS NOT NULL) AS "has"
      FROM "KnowledgeItem"
     WHERE "id" IN (${Prisma.join(ids)})
  `;
  const embFlags = new Map(embRows.map((r) => [r.id, r.has]));
  return rows.map((r) => ({
    ...r,
    hasEmbedding: embFlags.get(r.id) ?? false,
  }));
}

export async function countItemsForTenant(tenantId: string): Promise<number> {
  return prisma.knowledgeItem.count({ where: { tenantId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding write path — pgvector via raw SQL.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the embed input for an item. Concatenates name / brand / sku /
 * description plus key:value pairs from specs (excluding reserved keys).
 *
 * Pure function — exposed for the embed worker (P8c) to call before
 * shipping the input to the embeddings provider, and for unit tests.
 */
export function buildItemEmbedText(args: {
  name: string;
  brand?: string | null;
  sku?: string | null;
  description?: string | null;
  specs?: Prisma.JsonValue | null;
}): string {
  const parts: string[] = [args.name.trim()];
  if (args.brand) parts.push(args.brand.trim());
  if (args.sku) parts.push(args.sku.trim());
  if (args.description) parts.push(args.description.trim());
  if (args.specs && typeof args.specs === "object" && !Array.isArray(args.specs)) {
    for (const [k, v] of Object.entries(args.specs as Record<string, unknown>)) {
      if (k.startsWith("_")) continue; // reserved keys (e.g. _template_id)
      if (v == null) continue;
      const s = typeof v === "string" ? v : String(v);
      const trimmed = s.trim();
      if (trimmed.length === 0) continue;
      parts.push(`${k}: ${trimmed}`);
    }
  }
  return parts.filter((p) => p.length > 0).join(" — ");
}

export async function attachItemEmbedding(args: {
  itemId: string;
  vector: number[];
}): Promise<void> {
  const literal = "[" + args.vector.join(",") + "]";
  await prisma.$executeRaw`
    UPDATE "KnowledgeItem"
       SET "embedding" = ${literal}::vector,
           "updatedAt" = NOW()
     WHERE "id" = ${args.itemId}
  `;
}

export async function listUnembeddedItemIds(args: {
  tenantId: string;
}): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "KnowledgeItem"
     WHERE "tenantId" = ${args.tenantId}
       AND "embedding" IS NULL
     ORDER BY "createdAt" ASC
  `;
  return rows.map((r) => r.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval (Phase 8c)
//
// Vector + lexical search on items, used by the orchestrator's parallel
// retrieval step alongside chunks and qna. Same RRF fusion shape as chunk
// retrieval lives in the retriever module; this file owns the SQL.
// ─────────────────────────────────────────────────────────────────────────────

export type RawItemHit = {
  itemId: string;
  name: string;
  category: string | null;
  brand: string | null;
  sku: string | null;
  currency: string | null;
  priceCents: number | null;
  availability: ItemAvailability;
  description: string | null;
  specs: Prisma.JsonValue;
  score: number;
};

import { HNSW_EF_SEARCH } from "@/server/knowledge/limits";

/**
 * Cosine-similarity vector search on KnowledgeItem.embedding, scoped to
 * one tenant. Same SET LOCAL hnsw.ef_search dance as chunk search.
 */
export async function vectorSearchItems(args: {
  tenantId: string;
  queryVector: number[];
  limit: number;
}): Promise<RawItemHit[]> {
  const literal = "[" + args.queryVector.join(",") + "]";
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`);
    return tx.$queryRaw<RawItemHit[]>`
      SELECT i."id"          AS "itemId",
             i."name"        AS "name",
             i."category"    AS "category",
             i."brand"       AS "brand",
             i."sku"         AS "sku",
             i."currency"    AS "currency",
             i."priceCents"  AS "priceCents",
             i."availability" AS "availability",
             i."description" AS "description",
             i."specs"       AS "specs",
             1 - (i."embedding" <=> ${literal}::vector) AS "score"
        FROM "KnowledgeItem" i
       WHERE i."tenantId" = ${args.tenantId}
         AND i."embedding" IS NOT NULL
       ORDER BY i."embedding" <=> ${literal}::vector ASC
       LIMIT ${args.limit}
    `;
  });
}

/**
 * Lexical (full-text) search on KnowledgeItem.searchVector — the GENERATED
 * weighted tsvector across name (A) / brand+sku (B) / description (C).
 * Same `'simple'` config as chunks for AR/FR/EN/Darija mixing.
 */
export async function lexicalSearchItems(args: {
  tenantId: string;
  query: string;
  limit: number;
}): Promise<RawItemHit[]> {
  return prisma.$queryRaw<RawItemHit[]>`
    SELECT i."id"          AS "itemId",
           i."name"        AS "name",
           i."category"    AS "category",
           i."brand"       AS "brand",
           i."sku"         AS "sku",
           i."currency"    AS "currency",
           i."priceCents"  AS "priceCents",
           i."availability" AS "availability",
           i."description" AS "description",
           i."specs"       AS "specs",
           ts_rank(i."searchVector", plainto_tsquery('simple', ${args.query})) AS "score"
      FROM "KnowledgeItem" i
     WHERE i."tenantId" = ${args.tenantId}
       AND i."searchVector" @@ plainto_tsquery('simple', ${args.query})
     ORDER BY "score" DESC
     LIMIT ${args.limit}
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification (operator-asserted "still correct")
// ─────────────────────────────────────────────────────────────────────────────

export async function markItemVerified(args: {
  tenantId: string;
  itemId: string;
}): Promise<void> {
  const result = await prisma.knowledgeItem.updateMany({
    where: { id: args.itemId, tenantId: args.tenantId },
    data: { lastVerifiedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Item not found");
}
