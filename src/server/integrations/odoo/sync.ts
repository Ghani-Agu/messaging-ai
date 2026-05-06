import "server-only";

import type {
  ItemAvailability,
  LiveDataSource,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/server/db/client";
import { decryptConfig } from "../crypto";
import { OdooClient } from "./client";
import { OdooConfigSchema, type OdooConfig } from "./config-schema";
import { OdooProductTemplateSchema, type OdooProductTemplate } from "./models";

/**
 * Odoo product sync.
 *
 * Pulls product.template rows where sale_ok=true AND active=true and
 * upserts each into KnowledgeItem (the shared item surface the brain
 * already retrieves from). Filters incrementally on `write_date` once
 * lastSyncedAt is set so subsequent runs only pull changes.
 *
 * Pagination: 200-record batches via search_read offset/limit. Stops
 * when a page returns fewer than the page size, signalling end-of-stream.
 *
 * Per-source status tracking is set at three points:
 *   - Sync start: lastSyncStartedAt = now, lastSyncError cleared
 *   - Sync success: lastSyncedAt = now, lastSyncStartedAt cleared,
 *     status = CONNECTED, syncedRecordCount += processed
 *   - Sync failure: lastSyncStartedAt cleared, status = ERROR,
 *     lastSyncError = err.message (no password leak — error messages
 *     from the OdooClient already redact)
 *
 * Collision case: if an operator manually created a KnowledgeItem with
 * the same (tenantId, externalId) pre-sync, the existing
 * @@unique([tenantId, externalId]) will block the synced upsert with
 * a P2002 — surfaced verbatim. The operator must delete or rename one
 * to resolve. CLAUDE.md and the schema comment document the intent.
 */

const PRODUCT_FIELDS_BASE = [
  "id",
  "name",
  "default_code",
  "list_price",
  "standard_price",
  "qty_available",
  "virtual_available",
  "categ_id",
  "type",
  "sale_ok",
  "active",
  "write_date",
  "barcode",
  "description_sale",
];

const PAGE_SIZE = 200;

export type SyncResult = {
  recordsProcessed: number;
  durationMs: number;
  isDelta: boolean;
};

export async function syncOdooProducts(
  source: LiveDataSource,
): Promise<SyncResult> {
  const startedAt = Date.now();
  const config = OdooConfigSchema.parse(
    JSON.parse(decryptConfig(source.encryptedConfig)),
  );

  const fields = [...PRODUCT_FIELDS_BASE];
  if (config.additionalFields?.brandField) {
    fields.push(config.additionalFields.brandField);
  }

  const client = new OdooClient(config);
  await client.authenticate();

  // Domain: only sellable, active products. On delta runs, also filter
  // by write_date — Odoo returns datetimes as "YYYY-MM-DD HH:MM:SS"
  // (space-separated, server-tz UTC). Match that wire format.
  const domain: unknown[] = [
    ["sale_ok", "=", true],
    ["active", "=", true],
  ];
  const isDelta = source.lastSyncedAt !== null;
  if (source.lastSyncedAt) {
    const cutoff = source.lastSyncedAt
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    domain.push(["write_date", ">", cutoff]);
  }

  await prisma.liveDataSource.update({
    where: { id: source.id },
    data: { lastSyncStartedAt: new Date(), lastSyncError: null },
  });

  let totalProcessed = 0;
  let offset = 0;

  try {
    // Paginate until we get a partial page (or empty). Each iteration
    // fetches up to PAGE_SIZE records and upserts each one.
    for (;;) {
      const rawRecords = await client.searchRead<unknown>(
        "product.template",
        domain,
        fields,
        { limit: PAGE_SIZE, offset },
      );
      if (rawRecords.length === 0) break;

      for (const raw of rawRecords) {
        const result = OdooProductTemplateSchema.safeParse(raw);
        if (!result.success) {
          // Skip malformed rows but log the issues for the operator.
          // We do NOT log the raw record itself — vendor custom fields
          // could carry sensitive data; we only log the validation
          // issues plus the upstream id when present.
          const idGuess =
            typeof raw === "object" &&
            raw !== null &&
            "id" in raw &&
            typeof (raw as { id?: unknown }).id === "number"
              ? (raw as { id: number }).id
              : null;
          console.warn("Skipping Odoo product with invalid shape", {
            sourceId: source.id,
            upstreamId: idGuess,
            issues: result.error.issues,
          });
          continue;
        }
        await upsertItem(
          source,
          result.data,
          config,
          raw as Record<string, unknown>,
        );
        totalProcessed++;
      }

      if (rawRecords.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    await prisma.liveDataSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStartedAt: null,
        syncedRecordCount: { increment: totalProcessed },
        status: "CONNECTED",
        lastSyncError: null,
      },
    });

    return {
      recordsProcessed: totalProcessed,
      durationMs: Date.now() - startedAt,
      isDelta,
    };
  } catch (err) {
    await prisma.liveDataSource.update({
      where: { id: source.id },
      data: {
        lastSyncStartedAt: null,
        status: "ERROR",
        lastSyncError: err instanceof Error ? err.message : "Unknown error",
      },
    });
    throw err;
  }
}

/**
 * Map Odoo's qty_available signal into the existing ItemAvailability
 * enum used by the brain. We don't introduce a parallel boolean
 * inStock column — the enum is the canonical surface and the brain
 * already reads from it.
 *
 * LOW_STOCK isn't easily inferable from product.template alone (Odoo
 * stocks live on stock.warehouse / stock.quant joins that the
 * read-only XML-RPC user typically can't reach). For v1 we treat
 * "low stock" as something the operator manually labels via the
 * Items dashboard; the sync only flips between IN_STOCK and OUT_OF_STOCK.
 * If LOW_STOCK was set manually, the next sync would clobber it —
 * acceptable trade-off since the synced value is "the ERP source of
 * truth," and we'll revisit when the freshness honesty layer ships.
 */
function mapAvailability(qtyAvailable: number): ItemAvailability {
  return qtyAvailable > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
}

async function upsertItem(
  source: LiveDataSource,
  product: OdooProductTemplate,
  config: OdooConfig,
  raw: Record<string, unknown>,
): Promise<void> {
  const externalId = String(product.id);
  const sku = product.default_code === false ? null : product.default_code;
  const description =
    product.description_sale === false ? null : product.description_sale;
  const category = product.categ_id ? product.categ_id[1] : null;

  // Brand is a many2one custom field name from config.additionalFields.
  // Odoo returns it as `[id, "Display Name"]` or false; we extract the
  // display name and use it as the brand label.
  let brand: string | null = null;
  if (config.additionalFields?.brandField) {
    const brandRaw = raw[config.additionalFields.brandField];
    if (
      Array.isArray(brandRaw) &&
      brandRaw.length === 2 &&
      typeof brandRaw[1] === "string"
    ) {
      brand = brandRaw[1];
    }
  }

  // Odoo write_date is "YYYY-MM-DD HH:MM:SS" in server time (UTC for
  // typical deployments). Normalize to ISO and tag UTC so downstream
  // freshness comparisons are unambiguous.
  const sourceUpdatedAt = new Date(`${product.write_date.replace(" ", "T")}Z`);

  const data: Prisma.KnowledgeItemUncheckedCreateInput = {
    tenantId: source.tenantId,
    liveDataSourceId: source.id,
    externalId,
    name: product.name,
    sku,
    priceCents: Math.round(product.list_price * 100),
    availability: mapAvailability(product.qty_available),
    quantityOnHand: product.qty_available,
    quantityAvailable: product.virtual_available,
    category,
    brand,
    description,
    sourceUpdatedAt,
    lastSyncedAt: new Date(),
  };

  // Use the (tenantId, liveDataSourceId, externalId) composite — synced
  // rows always carry a non-null liveDataSourceId so this never collides
  // with manual entries (which use the (tenantId, externalId) unique).
  await prisma.knowledgeItem.upsert({
    where: {
      tenantId_liveDataSourceId_externalId: {
        tenantId: source.tenantId,
        liveDataSourceId: source.id,
        externalId,
      },
    },
    create: data,
    update: {
      name: data.name,
      sku: data.sku,
      priceCents: data.priceCents,
      availability: data.availability,
      quantityOnHand: data.quantityOnHand,
      quantityAvailable: data.quantityAvailable,
      category: data.category,
      brand: data.brand,
      description: data.description,
      sourceUpdatedAt: data.sourceUpdatedAt,
      lastSyncedAt: data.lastSyncedAt,
    },
  });
}
