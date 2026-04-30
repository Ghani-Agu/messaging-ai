"use server";

import { requireTenantContext } from "@/server/tenancy/context";
import {
  countItemsForTenant,
  createItem,
  deleteItem,
  getItem,
  knowledgeItemInputSchema,
  listItemsForTenant,
  markAllItemsVerifiedForTenant,
  markItemVerified,
  updateItem,
  type ItemSummary,
  type KnowledgeItemInput,
} from "@/server/db/items";
import type { KnowledgeItem } from "@prisma/client";

/**
 * Server Actions for the Products / Items admin surface (Phase 8c).
 *
 * AGENT-floor for create / edit / delete / verify per Gate-1 E (revisit
 * role split when multi-agent trust becomes a concern). VIEWER-floor for
 * the listing reads. Every action calls requireTenantContext(slug, ...);
 * client-supplied tenantId is never trusted — same hard rule as Phase 3.
 *
 * Each create / update enqueues the embed worker (single-item batch
 * inside db/items.ts). The list / edit / delete UI works fully without
 * waiting for the embed — newly-created items just don't surface in
 * semantic search until the worker catches up (typically a couple
 * seconds).
 */

export async function loadItems(
  slug: string,
  filters?: { category?: string; search?: string },
): Promise<{ items: ItemSummary[]; count: number }> {
  const ctx = await requireTenantContext(slug, { minRole: "VIEWER" });
  const [items, count] = await Promise.all([
    listItemsForTenant({
      tenantId: ctx.tenant.id,
      category: filters?.category,
      search: filters?.search,
    }),
    countItemsForTenant(ctx.tenant.id),
  ]);
  return { items, count };
}

export async function loadItem(
  slug: string,
  itemId: string,
): Promise<KnowledgeItem | null> {
  const ctx = await requireTenantContext(slug, { minRole: "VIEWER" });
  return getItem({ tenantId: ctx.tenant.id, itemId });
}

export async function createItemAction(
  slug: string,
  input: unknown,
): Promise<{ id: string }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  // Re-parse on the server. Client form validates first; this is the
  // trust-boundary check.
  const parsed: KnowledgeItemInput = knowledgeItemInputSchema.parse(input);
  return createItem({ tenantId: ctx.tenant.id, input: parsed });
}

export async function updateItemAction(
  slug: string,
  itemId: string,
  input: unknown,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  const parsed: KnowledgeItemInput = knowledgeItemInputSchema.parse(input);
  await updateItem({ tenantId: ctx.tenant.id, itemId, input: parsed });
  return { ok: true };
}

export async function deleteItemAction(
  slug: string,
  itemId: string,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  await deleteItem({ tenantId: ctx.tenant.id, itemId });
  return { ok: true };
}

export async function markItemVerifiedAction(
  slug: string,
  itemId: string,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  await markItemVerified({ tenantId: ctx.tenant.id, itemId });
  return { ok: true };
}

/**
 * Stamp lastVerifiedAt on every item in the tenant's catalog. Useful
 * after an operator does a quick read-through after a price sweep —
 * one click clears the stale-after-N-days banners across all items.
 */
export async function markAllItemsVerifiedAction(
  slug: string,
): Promise<{ count: number }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  return markAllItemsVerifiedForTenant({ tenantId: ctx.tenant.id });
}
