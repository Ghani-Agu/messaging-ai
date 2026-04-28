import "server-only";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { createRedisConnection } from "../connection";
import {
  EMBED_QUEUE_NAME,
  type EmbedBatchJobData,
  type EmbedJobData,
  type EmbedJobName,
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

/**
 * Worker for the `embed` queue. Each job embeds a small batch of chunk IDs
 * (typically 32) and atomically marks the source READY when the last
 * unembedded chunk for the source flips. Default lock duration is fine
 * here — embed batches finish in seconds.
 */
export function startEmbedWorker(): Worker<EmbedJobData, unknown, EmbedJobName> {
  const worker = new Worker<EmbedJobData, unknown, EmbedJobName>(
    EMBED_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case "embed-batch":
          return handleEmbedBatch(job as Job<EmbedBatchJobData, unknown, "embed-batch">);
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
