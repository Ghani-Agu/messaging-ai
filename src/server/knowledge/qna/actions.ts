"use server";

import { requireTenantContext } from "@/server/tenancy/context";
import {
  bulkDeleteQnaPairs,
  countQnaPairsForTenant,
  createQnaPair,
  deleteQnaPair,
  getQnaPair,
  listQnaPairsForTenant,
  qnaPairInputSchema,
  QnaDuplicateError,
  updateQnaPair,
  type QnaPairInput,
  type QnaPairSummary,
} from "@/server/db/qna";
import type { QnaPair } from "@prisma/client";

/**
 * Server Actions for the Q&A admin surface (Phase 8e).
 *
 * AGENT-floor for create / edit / delete per Gate-1 E. VIEWER-floor for
 * the listing reads. Every action calls requireTenantContext(slug, ...);
 * client-supplied tenantId is never trusted.
 *
 * Each create / update enqueues the embed worker (single-Q&A batch
 * inside db/qna.ts via enqueueEmbedQna). The list / edit / delete UI
 * works fully without waiting for the embed — a newly-created Q&A just
 * doesn't surface in semantic match until the worker catches up
 * (typically a couple seconds).
 */

export async function loadQnaPairs(
  slug: string,
  filters?: { language?: string; search?: string },
): Promise<{ pairs: QnaPairSummary[]; count: number }> {
  const ctx = await requireTenantContext(slug, { minRole: "VIEWER" });
  const [pairs, count] = await Promise.all([
    listQnaPairsForTenant({
      tenantId: ctx.tenant.id,
      language: filters?.language,
      search: filters?.search,
    }),
    countQnaPairsForTenant(ctx.tenant.id),
  ]);
  return { pairs, count };
}

export async function loadQnaPair(
  slug: string,
  qnaId: string,
): Promise<QnaPair | null> {
  const ctx = await requireTenantContext(slug, { minRole: "VIEWER" });
  return getQnaPair({ tenantId: ctx.tenant.id, qnaId });
}

/**
 * On dedupe conflict, the helper throws QnaDuplicateError with the
 * existingPairId. We re-throw a plain Error here because Server Actions
 * serialize errors over the wire — custom Error classes don't survive.
 * The message includes a stable `[duplicate:<id>]` marker so the client
 * can split it out and link to the existing pair.
 */
export async function createQnaPairAction(
  slug: string,
  input: unknown,
): Promise<{ id: string }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  const parsed: QnaPairInput = qnaPairInputSchema.parse(input);
  try {
    return await createQnaPair({ tenantId: ctx.tenant.id, input: parsed });
  } catch (err) {
    if (err instanceof QnaDuplicateError) {
      throw new Error(
        `A Q&A pair for this question already exists. [duplicate:${err.existingPairId}]`,
      );
    }
    throw err;
  }
}

export async function updateQnaPairAction(
  slug: string,
  qnaId: string,
  input: unknown,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  const parsed: QnaPairInput = qnaPairInputSchema.parse(input);
  try {
    await updateQnaPair({ tenantId: ctx.tenant.id, qnaId, input: parsed });
    return { ok: true };
  } catch (err) {
    if (err instanceof QnaDuplicateError) {
      throw new Error(
        `Editing this question would collide with an existing Q&A pair. [duplicate:${err.existingPairId}]`,
      );
    }
    throw err;
  }
}

export async function deleteQnaPairAction(
  slug: string,
  qnaId: string,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  await deleteQnaPair({ tenantId: ctx.tenant.id, qnaId });
  return { ok: true };
}

/**
 * Bulk delete — accepts a list of qna ids, scoped to the tenant. The DB
 * helper drops the WHERE on tenantId, so a malicious caller can't delete
 * another tenant's Q&A by guessing ids.
 */
export async function bulkDeleteQnaPairsAction(
  slug: string,
  input: { qnaIds: string[] },
): Promise<{ count: number }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  return bulkDeleteQnaPairs({
    tenantId: ctx.tenant.id,
    qnaIds: input.qnaIds ?? [],
  });
}
