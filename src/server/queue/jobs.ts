import "server-only";
import {
  DEFAULT_JOB_OPTIONS,
  embedQueue,
  ingestQueue,
} from "./queues";

/**
 * Helpers that producers (Server Actions, workers) call instead of touching
 * Queue.add() directly. Centralizing the job-shape construction means a
 * field rename to a payload type only has to be reflected in one place.
 */

const EMBED_BATCH_SIZE = 32;

export async function enqueueCrawlWebsite(args: {
  sourceId: string;
  tenantId: string;
  rootUrl: string;
}): Promise<void> {
  await ingestQueue.add("crawl-website", args, DEFAULT_JOB_OPTIONS);
}

export async function enqueueParseFile(args: {
  sourceId: string;
  tenantId: string;
  storagePath: string;
  filename: string;
}): Promise<void> {
  await ingestQueue.add("parse-file", args, DEFAULT_JOB_OPTIONS);
}

/**
 * Slice `chunkIds` into batches of EMBED_BATCH_SIZE and enqueue an
 * `embed-batch` job for each slice. Used by the ingest worker once chunks
 * are inserted, and by reingestSource when MANUAL chunks are re-embedded.
 */
export async function enqueueEmbedBatches(args: {
  sourceId: string;
  tenantId: string;
  chunkIds: string[];
}): Promise<void> {
  for (let i = 0; i < args.chunkIds.length; i += EMBED_BATCH_SIZE) {
    const batch = args.chunkIds.slice(i, i + EMBED_BATCH_SIZE);
    await embedQueue.add(
      "embed-batch",
      {
        sourceId: args.sourceId,
        tenantId: args.tenantId,
        chunkIds: batch,
      },
      DEFAULT_JOB_OPTIONS,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8b stubs — typed-knowledge embeddings.
//
// P8c lands the actual embed worker discriminator
// ({ kind: "chunk" | "item" | "qna" }) and routes through it; for P8b these
// helpers are no-ops so item/qna create paths can call them without
// further changes when the worker arrives. Items + Q&A created in P8b
// stay `embedding IS NULL` and don't surface in semantic search yet —
// list/edit/delete still works.
// ─────────────────────────────────────────────────────────────────────────────

export async function enqueueEmbedItem(args: {
  itemId: string;
  tenantId: string;
}): Promise<void> {
  // No-op until P8c. Argument retained so the call site is final.
  void args;
  return;
}

export async function enqueueEmbedQna(args: {
  qnaId: string;
  tenantId: string;
}): Promise<void> {
  // No-op until P8c.
  void args;
  return;
}

export async function enqueueEmbedKnowledgeGap(args: {
  gapId: string;
  tenantId: string;
}): Promise<void> {
  // No-op until P8g (gap clustering).
  void args;
  return;
}
