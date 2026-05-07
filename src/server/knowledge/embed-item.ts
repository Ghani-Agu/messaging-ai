import "server-only";

import type { KnowledgeItem } from "@prisma/client";
import { embed } from "@/server/ai/embeddings";
import { attachItemEmbedding, buildItemEmbedText } from "@/server/db/items";

/**
 * Inline embedding for a single KnowledgeItem.
 *
 * Phase 8c stores item embeddings on KnowledgeItem.embedding directly (not
 * on KnowledgeChunk — chunks have no itemId relation). The manual-import
 * path enqueues `embed-items-batch` onto BullMQ and the worker
 * (queue/workers/embed.ts handleEmbedItemsBatch) does the same three-step
 * dance this helper does inline:
 *
 *   1. buildItemEmbedText(item) — same composer the worker uses, so synced
 *      and manual items share one vector space.
 *   2. embed({ inputs: [text], inputType: "document" }) — provider failover
 *      and 1024-dim output handled by the unified client.
 *   3. attachItemEmbedding({ itemId, vector }) — raw-SQL UPDATE on the
 *      Unsupported("vector(1024)") column. Idempotent: re-running just
 *      overwrites the previous vector (no chunk-row cleanup needed).
 *
 * Used by the Odoo sync (so synced upserts become retrievable immediately
 * within the request) and the backfill script. The queue path remains
 * authoritative for manual imports.
 *
 * Errors propagate. Callers that batch (sync, backfill) decide whether one
 * item's failure aborts the run or just gets logged and skipped.
 */
export async function embedKnowledgeItem(item: KnowledgeItem): Promise<void> {
  const text = buildItemEmbedText(item);
  if (!text || text.trim().length === 0) return;

  const result = await embed({
    inputs: [text],
    inputType: "document",
  });
  const vector = result.vectors[0];
  if (!vector) return;

  await attachItemEmbedding({ itemId: item.id, vector });
}
