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
// Phase 8c — typed-knowledge embeddings.
//
// Separate job types per kind (rather than a single discriminated job)
// because items / qna don't carry a sourceId and each has its own
// attach-vector helper. Workers in src/server/queue/workers/embed.ts
// dispatch via BullMQ's named-job routing.
//
// Same EMBED_BATCH_SIZE (32) as Phase-3 chunks — the embeddings provider's
// per-call batch limit dominates; one tenant uploading 5,000 items at once
// fans into 157 jobs that BullMQ schedules with the embed worker's
// concurrency=4. A few minutes end-to-end on Voyage's free tier.
// ─────────────────────────────────────────────────────────────────────────────

export async function enqueueEmbedItems(args: {
  tenantId: string;
  itemIds: string[];
}): Promise<void> {
  if (args.itemIds.length === 0) return;
  for (let i = 0; i < args.itemIds.length; i += EMBED_BATCH_SIZE) {
    const batch = args.itemIds.slice(i, i + EMBED_BATCH_SIZE);
    await embedQueue.add(
      "embed-items-batch",
      { tenantId: args.tenantId, itemIds: batch },
      DEFAULT_JOB_OPTIONS,
    );
  }
}

export async function enqueueEmbedQna(args: {
  tenantId: string;
  qnaIds: string[];
}): Promise<void> {
  if (args.qnaIds.length === 0) return;
  for (let i = 0; i < args.qnaIds.length; i += EMBED_BATCH_SIZE) {
    const batch = args.qnaIds.slice(i, i + EMBED_BATCH_SIZE);
    await embedQueue.add(
      "embed-qna-batch",
      { tenantId: args.tenantId, qnaIds: batch },
      DEFAULT_JOB_OPTIONS,
    );
  }
}

/**
 * KnowledgeGap embedding + clustering (Phase 8g). Each new gap becomes
 * one job; the embed-gaps-batch worker handler embeds the question,
 * attaches the vector, then runs greedy cluster-on-write — see
 * src/server/queue/workers/embed.ts handleEmbedGapsBatch for the
 * cluster algorithm + the GAP_CLUSTER_CANDIDATE_CAP fallback.
 *
 * Single-gap calls are normal (gaps arrive one at a time from
 * webhook handlers); a `gapIds` array signature is kept for symmetry
 * with the items / qna paths and to support backfill scripts later.
 */
export async function enqueueEmbedKnowledgeGap(args: {
  tenantId: string;
  gapIds: string[];
}): Promise<void> {
  if (args.gapIds.length === 0) return;
  for (let i = 0; i < args.gapIds.length; i += EMBED_BATCH_SIZE) {
    const batch = args.gapIds.slice(i, i + EMBED_BATCH_SIZE);
    await embedQueue.add(
      "embed-gaps-batch",
      { tenantId: args.tenantId, gapIds: batch },
      DEFAULT_JOB_OPTIONS,
    );
  }
}
