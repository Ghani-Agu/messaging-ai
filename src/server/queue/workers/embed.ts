import "server-only";
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../connection";
import {
  EMBED_QUEUE_NAME,
  type EmbedBatchJobData,
  type EmbedJobData,
  type EmbedJobName,
} from "../queues";

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
  _job: Job<EmbedBatchJobData, unknown, "embed-batch">,
): Promise<unknown> {
  // Wired up in step 5/6 once chunks start landing in the DB.
  throw new Error("embed-batch handler not implemented yet (Phase 3, step 5/6)");
}
