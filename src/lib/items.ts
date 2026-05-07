/**
 * KnowledgeItem schemas + pure helpers (Phase 8c).
 *
 * Lives in src/lib/ rather than src/server/db/ for the same reason
 * src/lib/operational-facts.ts does: the item-form / items-list client
 * components import this module, and `"server-only"` trips the bundler
 * even on `import type` paths. The server-side DB layer
 * (src/server/db/items.ts) keeps the Prisma helpers + re-exports the
 * schemas / types from here for source compatibility with existing
 * callers (the orchestrator, the embed worker, etc.).
 */

import { z } from "zod";
import type { ItemAvailability, KnowledgeItem } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Specs (free-form bag with reserved keys)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spec values are flexible — any business can pin whatever fields they need
 * (color, size, weight, technical specs). Reserved keys carry semantics:
 *
 *   _template_id?: string — points to a category form template for future
 *     per-category UI rendering (Gate-1 A). Opaque at this layer; the
 *     dashboard form layer reads it to pick a render strategy.
 *
 * Values constrained to JSON-primitive scalars so the embed worker can
 * flatten them to text without nested-object surgery.
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
// Embedding text (pure helper — used by the embed worker)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subset of KnowledgeItem fields needed to compose the embed text. Optional
 * fields are typed `?: T | null` so a full KnowledgeItem (where these are
 * `T | null`) satisfies the shape structurally, AND tests can pass partial
 * fixtures without filling every nullable column. Both the embed worker and
 * the inline `embedKnowledgeItem` helper just pass `item`.
 */
export type ItemEmbedSource = {
  name: KnowledgeItem["name"];
  brand?: KnowledgeItem["brand"];
  category?: KnowledgeItem["category"];
  sku?: KnowledgeItem["sku"];
  description?: KnowledgeItem["description"];
  specs?: unknown;
};

/**
 * Build the embed input for an item. Composes name + labelled brand /
 * category / SKU + description + free-form spec key:value pairs.
 *
 * Order matters for retrieval quality: embedding models tend to weight
 * earlier tokens slightly more, so the discriminative fields (brand,
 * category) sit near the front.
 *
 *   name → "Marque: <brand>" → "Catégorie: <category>" → "SKU: <sku>"
 *        → description → "<specKey>: <value>" pairs (excluding reserved
 *        underscore-prefixed keys)
 *
 * Why labelled in French ("Marque", "Catégorie") and not English: customer
 * queries on this platform are predominantly FR / Darija / mixed, so the
 * label tokens themselves can co-occur with customer phrasing during
 * retrieval. Specs intentionally use bare `key: value` because keys are
 * heterogeneous and any fixed prefix would mislabel half the time.
 *
 * Brand inference (from name's first token, etc.) was considered and
 * dropped for v1 — too many false positives on patterns like "XVR Dahua…"
 * (XVR is a product line, Dahua is the brand). Synced items with brand=null
 * still get the category boost, and the embedding model already learns the
 * brand from the start of `name` for most synced products.
 *
 * Pure function — exposed for the embed worker (queue/workers/embed.ts),
 * the inline embed helper (server/knowledge/embed-item.ts), and unit tests.
 */
export function buildItemEmbedText(item: ItemEmbedSource): string {
  const parts: string[] = [item.name.trim()];
  if (item.brand) parts.push(`Marque: ${item.brand.trim()}`);
  if (item.category) parts.push(`Catégorie: ${item.category.trim()}`);
  if (item.sku) parts.push(`SKU: ${item.sku.trim()}`);
  if (item.description) parts.push(item.description.trim());
  if (item.specs && typeof item.specs === "object" && !Array.isArray(item.specs)) {
    for (const [k, v] of Object.entries(item.specs as Record<string, unknown>)) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Read shape — used by both server (db/items.ts) and client UI.
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
