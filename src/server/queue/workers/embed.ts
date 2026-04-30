import "server-only";
import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { createRedisConnection } from "../connection";
import {
  EMBED_QUEUE_NAME,
  type EmbedBatchJobData,
  type EmbedGapsBatchJobData,
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
import {
  attachGapEmbedding,
  countClusterCandidates,
  findBestClusterCandidate,
  getGapForEmbedding,
  setKnowledgeGapClusterKey,
} from "@/server/db/knowledge-gaps";
import {
  GAP_CLUSTER_CANDIDATE_CAP,
  GAP_CLUSTER_THRESHOLD,
  GAP_CLUSTER_WINDOW_DAYS,
} from "@/server/knowledge/limits";
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
        case "embed-gaps-batch":
          return handleEmbedGapsBatch(
            job as Job<EmbedGapsBatchJobData, unknown, "embed-gaps-batch">,
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8g — knowledge-gap embedding + cluster-on-write
//
// Each new KnowledgeGap row triggers one job here. The handler:
//   1. Embeds the question (inputType: "query" — same asymmetric path
//      as Q&A, since gaps are matched against future incoming questions
//      when the operator answers one).
//   2. Attaches the embedding via raw SQL.
//   3. Runs greedy cluster-on-write — finds the best similar gap in the
//      last GAP_CLUSTER_WINDOW_DAYS for the tenant, capped at
//      GAP_CLUSTER_CANDIDATE_CAP comparisons. Above the cap the
//      worker SKIPS clustering (clusterKey stays null) and logs a
//      structured warning; the digest UI shows backlog.
//
// Cluster join rule:
//   - Best candidate has a clusterKey → new gap inherits it (joining
//     an existing cluster).
//   - Best candidate has null clusterKey → mint a fresh clusterKey,
//     assign to BOTH the new gap AND the candidate (seeding a new
//     two-member cluster from two previously-orphaned similar gaps).
//   - No candidate clears GAP_CLUSTER_THRESHOLD → mint a fresh
//     clusterKey, assign only to the new gap (sole-member cluster
//     waiting for a similar gap to arrive).
// ─────────────────────────────────────────────────────────────────────────────

async function handleEmbedGapsBatch(
  job: Job<EmbedGapsBatchJobData, unknown, "embed-gaps-batch">,
): Promise<{ embedded: number; clustered: number; skipped: number }> {
  const { tenantId, gapIds } = job.data;
  let embedded = 0;
  let clustered = 0;
  let skipped = 0;
  // Process gaps sequentially. Per-gap clustering depends on the latest
  // candidate state, including any gaps just-clustered earlier in the
  // same batch. Sequential keeps the reads consistent.
  for (const gapId of gapIds) {
    const gap = await getGapForEmbedding(gapId);
    if (!gap || gap.tenantId !== tenantId) continue;
    if (gap.hasEmbedding) {
      // Idempotency: already embedded in a prior run. Still re-run the
      // cluster step in case it was skipped due to cap pressure earlier.
      const did = await runClusterStep(tenantId, gapId);
      if (did === "clustered") clustered++;
      else if (did === "skipped") skipped++;
      continue;
    }

    // Embed (single-item batch is fine; per-call provider RTT dominates
    // anyway and gap insertions are sparse).
    const result = await embed({
      inputs: [gap.question],
      inputType: "query",
    });
    await attachGapEmbedding({ gapId: gap.id, vector: result.vectors[0]! });
    embedded++;

    // Cluster.
    const did = await runClusterStep(tenantId, gapId);
    if (did === "clustered") clustered++;
    else if (did === "skipped") skipped++;
  }
  return { embedded, clustered, skipped };
}

async function runClusterStep(
  tenantId: string,
  gapId: string,
): Promise<"clustered" | "skipped" | "no-candidate"> {
  // Cap check first — count is a cheap COUNT(*) against the same
  // composite index the candidate query would use.
  const candidates = await countClusterCandidates({
    tenantId,
    excludeGapId: gapId,
    sinceDays: GAP_CLUSTER_WINDOW_DAYS,
  });
  if (candidates > GAP_CLUSTER_CANDIDATE_CAP) {
    console.warn(
      `[embed-gaps] tenant=${tenantId} gap=${gapId}: skipping clustering — ` +
        `${candidates} candidates exceeds cap ${GAP_CLUSTER_CANDIDATE_CAP}. ` +
        `clusterKey left null; digest UI will surface this gap in the unclustered backlog.`,
    );
    return "skipped";
  }

  // Re-load the gap's vector for the candidate query. We don't pass it
  // through from the embed step because clustering is also called for
  // already-embedded re-runs (idempotent path), where we don't have the
  // vector in memory.
  const vec = await prisma.$queryRaw<Array<{ vec: string }>>`
    SELECT "embedding"::text AS vec FROM "KnowledgeGap"
     WHERE "id" = ${gapId} AND "embedding" IS NOT NULL
  `;
  if (vec.length === 0) return "no-candidate"; // shouldn't happen — caller
                                                 // path always attaches first.
  const queryVector = parsePgVector(vec[0]!.vec);

  const best = await findBestClusterCandidate({
    tenantId,
    excludeGapId: gapId,
    queryVector,
    threshold: GAP_CLUSTER_THRESHOLD,
    sinceDays: GAP_CLUSTER_WINDOW_DAYS,
    limit: GAP_CLUSTER_CANDIDATE_CAP,
  });

  if (!best) {
    // No similar gap → mint a sole-member cluster. New gaps that arrive
    // similar to this one will join via the candidate-has-clusterKey
    // branch.
    const fresh = randomUUID();
    await setKnowledgeGapClusterKey({ gapId, clusterKey: fresh });
    return "clustered";
  }

  if (best.clusterKey) {
    // Join an existing cluster.
    await setKnowledgeGapClusterKey({ gapId, clusterKey: best.clusterKey });
    return "clustered";
  }

  // Both gaps unclustered — seed a new cluster from this pair.
  const fresh = randomUUID();
  await setKnowledgeGapClusterKey({ gapId, clusterKey: fresh });
  await setKnowledgeGapClusterKey({ gapId: best.gapId, clusterKey: fresh });
  return "clustered";
}

/**
 * Parse pgvector's text form `[a,b,c,...]` back into a number[]. The
 * cluster step reads the gap's embedding back via raw SQL because
 * Prisma can't bind Unsupported(...) columns.
 */
function parsePgVector(text: string): number[] {
  // Strip the brackets and split on comma. Trim per-element to handle
  // any whitespace pgvector might insert.
  const inner = text.replace(/^\[/, "").replace(/\]$/, "");
  if (!inner) return [];
  return inner.split(",").map((s) => Number.parseFloat(s.trim()));
}

