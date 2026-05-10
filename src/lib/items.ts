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
// Brand inference (conservative, hardcoded list)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known security / network / display brands that frequently appear at the
 * start of a product name in the WBP catalog (and similar verticals).
 * Used by sync.ts when the Odoo brand custom-field is missing or unset,
 * and as a fallback in buildItemEmbedText when item.brand is null.
 *
 * Hardcoded by design (v1). When a second customer in a different vertical
 * (ecommerce, food, fashion) onboards, the right move is per-tenant brand
 * lists or a smarter signal — not extending this list with non-domain
 * entries. Keep this list curated to brand names you'd ALWAYS want to
 * infer; "Camera", "Modem", and other product nouns must NOT live here.
 *
 * Match is case-insensitive on the first whitespace-delimited token of
 * the item name. Output is normalized to a canonical capitalization
 * (first letter upper, rest lower) so downstream rendering + grouping
 * stays consistent regardless of how the operator wrote the product name.
 */
export const KNOWN_BRANDS_AT_NAME_START = [
  "AJAX",
  "DAHUA",
  "IMOU",
  "HIKVISION",
  "UBIQUITI",
  "MAXHUB",
  "TPLINK",
  "TP-LINK",
  "MIKROTIK",
  "CAMBIUM",
  "RUIJIE",
] as const;

/**
 * Infer a brand name from the first token of a product name, matching
 * against KNOWN_BRANDS_AT_NAME_START (case-insensitive). Returns null when
 * the first token isn't on the list — never guess. The canonical-cap output
 * ("AJAX" → "Ajax", "TP-LINK" → "Tp-link") gives downstream code a single
 * stable string per brand even when source catalogs vary in capitalization.
 *
 * Pure function — safe to call from sync workers, embed helpers, and
 * client UI alike.
 */
export function inferBrandFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const firstToken = trimmed.split(/\s+/)[0];
  if (!firstToken) return null;
  const upperToken = firstToken.toUpperCase();
  for (const known of KNOWN_BRANDS_AT_NAME_START) {
    if (upperToken === known) {
      // Canonical form: first letter upper, rest lower. Handles hyphenated
      // multi-segment names (TP-LINK → Tp-link) the same way — operators
      // who really care about display capitalization can override via the
      // explicit brand field.
      return known.charAt(0) + known.slice(1).toLowerCase();
    }
  }
  return null;
}

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
 * Brand fallback: when item.brand is null/empty, infer from the first
 * name token via inferBrandFromName (KNOWN_BRANDS_AT_NAME_START list).
 * Manual items + correctly-synced items already have brand set and pass
 * the explicit-brand branch; the fallback exists primarily for synced
 * rows from sources where the brand custom-field name is unknown (WBP's
 * Odoo case). The original v1 decision to skip brand inference (item.ts
 * comment removed in this commit) was overcautious — the curated list
 * keeps false positives near zero for the platform's current domain.
 *
 * Pure function — exposed for the embed worker (queue/workers/embed.ts),
 * the inline embed helper (server/knowledge/embed-item.ts), and unit tests.
 */
export function buildItemEmbedText(item: ItemEmbedSource): string {
  const parts: string[] = [item.name.trim()];
  const brand = item.brand?.trim() ? item.brand.trim() : inferBrandFromName(item.name);
  if (brand) parts.push(`Marque: ${brand}`);
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
