"use server";

import { requireTenantContext } from "@/server/tenancy/context";
import {
  createItem,
  deleteItem,
  getItem,
  knowledgeItemInputSchema,
  markAllItemsVerifiedForTenant,
  markItemVerified,
  updateItem,
  type KnowledgeItemInput,
} from "@/server/db/items";
import type { KnowledgeItem } from "@prisma/client";
import { getClaudeClient, type StructuredItemDraft } from "@/server/ai/claude-client";
import { importCsvForItems, type CsvImportResult } from "@/lib/csv-import";

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

export async function loadItem(
  slug: string,
  itemId: string,
): Promise<KnowledgeItem | null> {
  const ctx = await requireTenantContext(slug, {
    minRole: "VIEWER",
    requiredPermission: "products:view",
  });
  return getItem({ tenantId: ctx.tenant.id, itemId });
}

export async function createItemAction(
  slug: string,
  input: unknown,
): Promise<{ id: string }> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
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
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
  const parsed: KnowledgeItemInput = knowledgeItemInputSchema.parse(input);
  await updateItem({ tenantId: ctx.tenant.id, itemId, input: parsed });
  return { ok: true };
}

export async function deleteItemAction(
  slug: string,
  itemId: string,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
  await deleteItem({ tenantId: ctx.tenant.id, itemId });
  return { ok: true };
}

export async function markItemVerifiedAction(
  slug: string,
  itemId: string,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
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
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
  return markAllItemsVerifiedForTenant({ tenantId: ctx.tenant.id });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8c — smart import + CSV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Smart import — operator pastes free-text catalog data, Claude
 * structures it, operator reviews + approves. P8c-4 ships against the
 * StubClaudeClient (rotating-wrong-field stub per Gate-1 K4); when the
 * real Claude wrapper lands the call site doesn't change.
 *
 * AGENT-floor (this is a write-shaped read — the operator's about to
 * commit drafts).
 */
export async function smartImportItemsAction(
  slug: string,
  input: { text: string },
): Promise<{ items: StructuredItemDraft[]; notes?: string }> {
  await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
  if (!input.text || !input.text.trim()) {
    throw new Error("Paste some catalog text first");
  }
  const client = getClaudeClient();
  if (!client.structureItemsFromText) {
    throw new Error("Smart import not available with this Claude client");
  }
  const r = await client.structureItemsFromText({ text: input.text });
  return { items: r.toolArgs.items, notes: r.toolArgs.notes };
}

/**
 * CSV preview — pure parse-and-validate. Does NOT write to the DB. The
 * operator commits via `commitImportedItemsAction` after reviewing the
 * preview UI.
 */
export async function previewCsvImportAction(
  slug: string,
  input: { csv: string },
): Promise<CsvImportResult> {
  await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
  return importCsvForItems(input.csv ?? "");
}

/**
 * Commit a batch of operator-approved item drafts. Each draft is
 * re-parsed through knowledgeItemInputSchema at the trust boundary.
 * Per-row failures are collected and reported back; we don't transactional-
 * fail the whole batch on one bad row (the operator sees which rows landed).
 */
export async function commitImportedItemsAction(
  slug: string,
  input: { items: unknown[] },
): Promise<{
  created: { id: string; row: number }[];
  failed: { row: number; error: string }[];
}> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "products:edit",
  });
  const created: { id: string; row: number }[] = [];
  const failed: { row: number; error: string }[] = [];
  for (let i = 0; i < (input.items ?? []).length; i++) {
    const raw = input.items[i];
    try {
      const parsed: KnowledgeItemInput = knowledgeItemInputSchema.parse(raw);
      const r = await createItem({ tenantId: ctx.tenant.id, input: parsed });
      created.push({ id: r.id, row: i + 1 });
    } catch (err) {
      failed.push({
        row: i + 1,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }
  return { created, failed };
}
