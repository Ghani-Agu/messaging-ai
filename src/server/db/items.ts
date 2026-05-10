import "server-only";
import {
  Prisma,
  type ItemAvailability,
  type KnowledgeItem,
} from "@prisma/client";
import { prisma } from "./client";
import { enqueueEmbedItems } from "@/server/queue/jobs";
import {
  knowledgeItemInputSchema,
  type ItemSummary,
  type KnowledgeItemInput,
} from "@/lib/items";

/**
 * KnowledgeItem DB layer (Phase 8b/c — Type 2: structured items).
 *
 * Same Unsupported-vector pattern as KnowledgeChunk: the `embedding` column
 * is read/written via raw SQL because Prisma can't bind `Unsupported(...)`.
 * The lexical column `searchVector` is GENERATED in the DB (raw SQL in the
 * migration) — Prisma never writes to it.
 *
 * Schemas + types + buildItemEmbedText live in src/lib/items.ts so client
 * components can import them — `"server-only"` trips the bundler even on
 * `import type` paths from a client component (verified empirically in
 * P8b's Business Info commit; same fix applied here in P8c-3). This
 * module re-exports the lib for callers that previously imported from
 * the server file (orchestrator, embed worker, items Server Actions).
 */

// Re-exports — keeps existing import sites working without churn.
export {
  buildItemEmbedText,
  itemAvailabilitySchema,
  itemAvailabilityValues,
  knowledgeItemInputSchema,
  knowledgeItemSpecsSchema,
} from "@/lib/items";
export type {
  ItemSummary,
  KnowledgeItemInput,
  KnowledgeItemSpecs,
} from "@/lib/items";


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

/**
 * Distinct, non-null categories present in the tenant's catalog. Used by
 * the Products page to populate the category-filter dropdown so options
 * reflect the entire catalog (not just the current paginated/filtered
 * page's items).
 */
export async function listDistinctCategoriesForTenant(
  tenantId: string,
): Promise<string[]> {
  const rows = await prisma.knowledgeItem.findMany({
    where: { tenantId, category: { not: null } },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category).filter((c): c is string => c !== null);
}

/**
 * Paginated list + total-count, both fetched in a single Prisma transaction.
 *
 * Used by the Products page so the operator can navigate the catalog with
 * `?page=N` instead of getting a silently-truncated 50-row view. The
 * embedding-presence enrichment runs as a separate raw query after the
 * transaction completes, same as `listItemsForTenant`.
 */
export async function listAndCountItemsForTenant(args: {
  tenantId: string;
  category?: string;
  search?: string;
  skip: number;
  take: number;
}): Promise<{ items: ItemSummary[]; count: number }> {
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
  const [rows, count] = await prisma.$transaction([
    prisma.knowledgeItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: args.take,
      skip: args.skip,
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
    }),
    prisma.knowledgeItem.count({ where }),
  ]);
  if (rows.length === 0) return { items: [], count };
  const ids = rows.map((r) => r.id);
  const embRows = await prisma.$queryRaw<Array<{ id: string; has: boolean }>>`
    SELECT "id", ("embedding" IS NOT NULL) AS "has"
      FROM "KnowledgeItem"
     WHERE "id" IN (${Prisma.join(ids)})
  `;
  const embFlags = new Map(embRows.map((r) => [r.id, r.has]));
  return {
    items: rows.map((r) => ({
      ...r,
      hasEmbedding: embFlags.get(r.id) ?? false,
    })),
    count,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding write path — pgvector via raw SQL.
// (buildItemEmbedText lives in @/lib/items and is re-exported above so
// both client form and embed worker share one implementation.)
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Substring/keyword search — SQL ILIKE on name + brand. Mirrors the
 * operator-side product search bar's behavior: when the customer asks
 * "wsh 3andkom Ajax?", retrieval should surface AJAX-named items the
 * same way the operator's "ajax" search returns them, even when the
 * vector embedding signal is weak for sparse-text catalog entries.
 *
 * Each call matches a single token. The orchestrator splits the
 * customer message into significant tokens (see extractSignificantTokens
 * in retriever.ts) and unions per-token results. Scoring is fixed: brand
 * matches outrank name matches (the operator-curated brand column is
 * higher-precision than free-form name substrings).
 *
 * Returns up to `limit` rows; the call site typically passes 30. Items
 * with no brand are still searchable via name.
 */
export async function keywordSearchItems(args: {
  tenantId: string;
  token: string;
  limit: number;
}): Promise<RawItemHit[]> {
  const pattern = `%${args.token}%`;
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
           CASE
             WHEN i."brand" ILIKE ${pattern} THEN 2.0
             WHEN i."name"  ILIKE ${pattern} THEN 1.0
             ELSE 0.0
           END AS "score"
      FROM "KnowledgeItem" i
     WHERE i."tenantId" = ${args.tenantId}
       AND (
         i."brand" ILIKE ${pattern}
         OR i."name" ILIKE ${pattern}
       )
     ORDER BY "score" DESC, i."name" ASC
     LIMIT ${args.limit}
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand aggregate — full-catalog counts per brand, with category breakdown.
// ─────────────────────────────────────────────────────────────────────────────

export type BrandAggregateCategoryRow = {
  /** null when the underlying items have no category set. */
  category: string | null;
  count: number;
  inStock: number;
};

export type BrandAggregateResult = {
  total: number;
  inStock: number;
  outOfStock: number;
  /** Top N categories by count, sorted descending. */
  categories: BrandAggregateCategoryRow[];
};

/**
 * Full-catalog aggregate for one brand inside one tenant. Used by the brand
 * summary line the retriever emits when a customer asks about a brand —
 * lets the brain answer "wsh 3andkom Dahua?" with category-aware totals
 * pulled from the WHOLE catalog, not just the keyword candidate pool the
 * retriever surfaces (capped at 30 rows).
 *
 * The query runs in a single round-trip: a CTE materializes the brand's
 * rows once, then the outer query reads two GROUPING SETS off it — the
 * `()` set produces the overall totals row (category IS NULL in the
 * result), and the per-category set produces one row per category. The
 * per-category rows are sorted by count desc and capped to `topCategories`
 * AFTER the union, so the cap doesn't cost us the overall row.
 *
 * The caller groups rows back into the shaped result; category=null in
 * the data is preserved so the renderer can place those items into an
 * "Autres" / Other bucket distinct from the overall totals row.
 */
export async function getBrandAggregate(args: {
  tenantId: string;
  brand: string;
  topCategories: number;
}): Promise<BrandAggregateResult> {
  type Row = {
    grouping_kind: 0 | 1; // 0 = overall, 1 = per-category
    category: string | null;
    count: bigint;
    in_stock: bigint;
    out_of_stock: bigint;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    WITH brand_items AS (
      SELECT "category", "availability"
        FROM "KnowledgeItem"
       WHERE "tenantId" = ${args.tenantId}
         AND "brand" = ${args.brand}
    ),
    overall AS (
      SELECT 0 AS grouping_kind,
             NULL::text AS category,
             COUNT(*) AS count,
             COUNT(*) FILTER (WHERE "availability" = 'IN_STOCK') AS in_stock,
             COUNT(*) FILTER (WHERE "availability" = 'OUT_OF_STOCK') AS out_of_stock
        FROM brand_items
    ),
    by_category AS (
      SELECT 1 AS grouping_kind,
             "category",
             COUNT(*) AS count,
             COUNT(*) FILTER (WHERE "availability" = 'IN_STOCK') AS in_stock,
             0::bigint AS out_of_stock
        FROM brand_items
       GROUP BY "category"
       ORDER BY count DESC, "category" NULLS LAST
       LIMIT ${args.topCategories}
    )
    SELECT grouping_kind, category, count, in_stock, out_of_stock FROM overall
    UNION ALL
    SELECT grouping_kind, category, count, in_stock, out_of_stock FROM by_category
  `;

  let total = 0;
  let inStock = 0;
  let outOfStock = 0;
  const categories: BrandAggregateCategoryRow[] = [];
  for (const r of rows) {
    if (r.grouping_kind === 0) {
      total = Number(r.count);
      inStock = Number(r.in_stock);
      outOfStock = Number(r.out_of_stock);
    } else {
      categories.push({
        category: r.category,
        count: Number(r.count),
        inStock: Number(r.in_stock),
      });
    }
  }
  return { total, inStock, outOfStock, categories };
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

/**
 * Bulk verify — stamps lastVerifiedAt on every item in the tenant. Used
 * by the "Mark all as verified" action after a price sweep / catalog
 * refresh (Gate-1 P8c note 7). Returns the affected row count for the
 * UI's confirmation toast.
 */
export async function markAllItemsVerifiedForTenant(args: {
  tenantId: string;
}): Promise<{ count: number }> {
  const result = await prisma.knowledgeItem.updateMany({
    where: { tenantId: args.tenantId },
    data: { lastVerifiedAt: new Date() },
  });
  return { count: result.count };
}
