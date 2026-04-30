import "server-only";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { createRedisConnection } from "../connection";
import {
  EMBED_QUEUE_NAME,
  type EmbedBatchJobData,
  type EmbedItemsBatchJobData,
  type EmbedJobData,
  type EmbedJobName,
  type EmbedQnaBatchJobData,
} from "../queues";
import { embed } from "@/server/ai/embeddings";
import {
  appendSourceLog,
  attachEmbeddings,
  incrementSourceProgressEmbedded,
  listUnembeddedChunksByIds,
  maybeMarkSourceReady,
  updateSourceStatus,
} from "@/server/db/knowledge";
import {
  attachItemEmbedding,
  buildItemEmbedText,
} from "@/server/db/items";
import { attachQnaEmbedding } from "@/server/db/qna";
import { prisma } from "@/server/db/client";

/**
 * Worker for the `embed` queue. Three job types:
 *   - `embed-batch`        — Phase 3 chunks. Marks source READY at end.
 *   - `embed-items-batch`  — Phase 8c structured items.
 *   - `embed-qna-batch`    — Phase 8c Q&A pairs (embeds the question text).
 *
 * Each handler is independent: a single batch failure for items doesn't
 * block chunks (separate jobs in BullMQ). Default lock duration is fine —
 * batches finish in seconds.
 */
export function startEmbedWorker(): Worker<EmbedJobData, unknown, EmbedJobName> {
  const worker = new Worker<EmbedJobData, unknown, EmbedJobName>(
    EMBED_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case "embed-batch":
          return handleEmbedBatch(job as Job<EmbedBatchJobData, unknown, "embed-batch">);
        case "embed-items-batch":
          return handleEmbedItemsBatch(
            job as Job<EmbedItemsBatchJobData, unknown, "embed-items-batch">,
          );
        case "embed-qna-batch":
          return handleEmbedQnaBatch(
            job as Job<EmbedQnaBatchJobData, unknown, "embed-qna-batch">,
          );
        default: {
          const exhaustive: never = job.name;
          throw new Error(`unhandled embed job name: ${String(exhaustive)}`);
        }
      }
    },
    {
      connection: createRedisConnection(),
      // Allow a couple of concurrent embed batches per worker process —
      // the bottleneck is the provider, not us.
      concurrency: 4,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[embed] job ${job?.id} (${job?.name}) failed:`, err.message);
  });
  worker.on("error", (err) => {
    console.error("[embed] worker error:", err.message);
  });
  return worker;
}

async function handleEmbedBatch(
  job: Job<EmbedBatchJobData, unknown, "embed-batch">,
): Promise<{ embedded: number }> {
  const { sourceId, chunkIds } = job.data;
  try {
    return await runEmbedBatch({ sourceId, chunkIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = job.opts.attempts ?? 1;
    const isFinal = err instanceof UnrecoverableError || job.attemptsMade >= attempts;
    if (isFinal) {
      await updateSourceStatus({ sourceId, status: "ERROR", error: message });
      await appendSourceLog({
        sourceId,
        level: "err",
        text: `Embedding failed: ${message}`,
      });
    } else {
      await appendSourceLog({
        sourceId,
        level: "err",
        text: `Embed batch attempt ${job.attemptsMade}/${attempts} failed (will retry): ${message}`,
      });
    }
    throw err;
  }
}

async function runEmbedBatch(args: {
  sourceId: string;
  chunkIds: string[];
}): Promise<{ embedded: number }> {
  const { sourceId, chunkIds } = args;

  // Idempotency: skip chunks that already have embeddings (from a prior
  // partial run, or a duplicate enqueue).
  const unembedded = await listUnembeddedChunksByIds({ chunkIds });
  if (unembedded.length === 0) {
    await maybeMarkSourceReady(sourceId);
    return { embedded: 0 };
  }

  const result = await embed({
    inputs: unembedded.map((c) => c.content),
    inputType: "document",
  });
  await attachEmbeddings({
    chunkIds: unembedded.map((c) => c.id),
    vectors: result.vectors,
  });
  await incrementSourceProgressEmbedded({
    sourceId,
    delta: unembedded.length,
  });

  if (await maybeMarkSourceReady(sourceId)) {
    await appendSourceLog({
      sourceId,
      level: "ok",
      text: `Ready (embedded via ${result.provider})`,
    });
  }
  return { embedded: unembedded.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8c — items embedding
// ─────────────────────────────────────────────────────────────────────────────

async function handleEmbedItemsBatch(
  job: Job<EmbedItemsBatchJobData, unknown, "embed-items-batch">,
): Promise<{ embedded: number }> {
  const { itemIds } = job.data;
  // Idempotency: skip items that already have an embedding (re-embed jobs
  // might fire after an update; if vector is fresh, no-op). Also lets us
  // tolerate duplicate enqueues without double-billing the provider.
  const present = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "KnowledgeItem"
     WHERE "id" IN (${itemIds.length > 0 ? Prisma.join(itemIds) : Prisma.empty})
       AND "embedding" IS NULL
  `;
  if (present.length === 0) return { embedded: 0 };

  const unembeddedIds = present.map((r) => r.id);
  // Re-load each item's text fields fresh (they may have changed since
  // enqueue). buildItemEmbedText concatenates name / brand / sku /
  // description + spec key:value pairs (excluding reserved _-prefix keys)
  // — same shape the lexical tsvector uses minus reserved keys.
  const rows = await Promise.all(
    unembeddedIds.map(async (id) => {
      const item = await getItemUnscoped(id);
      if (!item) return null;
      const text = buildItemEmbedText({
        name: item.name,
        brand: item.brand,
        sku: item.sku,
        description: item.description,
        specs: item.specs,
      });
      if (!text || text.trim().length === 0) return null;
      return { id: item.id, text };
    }),
  );
  const usable = rows.filter((r): r is { id: string; text: string } => r !== null);
  if (usable.length === 0) return { embedded: 0 };

  const result = await embed({
    inputs: usable.map((r) => r.text),
    inputType: "document",
  });
  // Per-item attach via raw SQL (vector column is Unsupported in Prisma).
  // Sequential rather than batched-update because attachItemEmbedding is
  // a single-row UPDATE; for typical batch sizes (≤32) the round-trip cost
  // is negligible compared to the embedding API call.
  for (let i = 0; i < usable.length; i++) {
    await attachItemEmbedding({
      itemId: usable[i]!.id,
      vector: result.vectors[i]!,
    });
  }
  return { embedded: usable.length };
}

/**
 * Worker-side fetch: doesn't take tenantId because the worker trusts the
 * job payload (which was minted by a Server Action that already enforced
 * tenancy). Same pattern as getSourceUnscoped.
 */
async function getItemUnscoped(itemId: string) {
  return prisma.knowledgeItem.findUnique({ where: { id: itemId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8c — Q&A embedding (embeds the QUESTION text — semantic match is
// against what customers ask, not the canonical answer).
// ─────────────────────────────────────────────────────────────────────────────

async function handleEmbedQnaBatch(
  job: Job<EmbedQnaBatchJobData, unknown, "embed-qna-batch">,
): Promise<{ embedded: number }> {
  const { qnaIds } = job.data;
  // Same idempotency / tolerance shape as items.
  const present = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "QnaPair"
     WHERE "id" IN (${qnaIds.length > 0 ? Prisma.join(qnaIds) : Prisma.empty})
       AND "questionEmbedding" IS NULL
  `;
  if (present.length === 0) return { embedded: 0 };

  const unembeddedIds = present.map((r) => r.id);
  const rows = await Promise.all(
    unembeddedIds.map(async (id) => {
      const qna = await prisma.qnaPair.findUnique({
        where: { id },
        select: { id: true, question: true },
      });
      if (!qna || !qna.question.trim()) return null;
      return { id: qna.id, text: qna.question };
    }),
  );
  const usable = rows.filter((r): r is { id: string; text: string } => r !== null);
  if (usable.length === 0) return { embedded: 0 };

  const result = await embed({
    inputs: usable.map((r) => r.text),
    inputType: "query",
    // We use inputType: "query" (not "document") because the embedding is
    // matched against incoming customer questions — Voyage's query/document
    // distinction is an asymmetric retrieval optimization. The retriever
    // also embeds the customer message with inputType: "query"; both sides
    // of the cosine match thus use the query-side embedding space. This
    // differs from chunks (document side); Q&A is its own retrieval channel
    // so the asymmetry is internally consistent.
  });
  for (let i = 0; i < usable.length; i++) {
    await attachQnaEmbedding({
      qnaId: usable[i]!.id,
      vector: result.vectors[i]!,
    });
  }
  return { embedded: usable.length };
}

