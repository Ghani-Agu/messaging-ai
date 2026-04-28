import "server-only";
import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

/**
 * Two queues power Phase-3 ingestion:
 *
 *  - `ingest` — driven by tenant action: `crawl-website`, `parse-file`. The
 *    worker for this queue runs the full pipeline up through inserting
 *    chunk rows (without embeddings), then enqueues `embed-batch` jobs.
 *  - `embed`  — embeds slices of unembedded chunks via the unified Voyage
 *    /OpenAI client, then atomically transitions the source to READY when
 *    no unembedded chunks remain.
 *
 * `ping` is an internal health-check job used by scripts/queue-ping.ts to
 * verify the worker round-trips against Upstash.
 */

export const INGEST_QUEUE_NAME = "ingest";
export const EMBED_QUEUE_NAME = "embed";

// Job-data shapes — discriminated by `job.name`, not by a `kind` field on
// the payload, so BullMQ's named-job routing is the source of truth.
export type CrawlWebsiteJobData = {
  sourceId: string;
  tenantId: string;
  rootUrl: string;
};
export type ParseFileJobData = {
  sourceId: string;
  tenantId: string;
  storagePath: string;
  filename: string;
};
export type PingJobData = {
  nonce: string;
};
export type EmbedBatchJobData = {
  sourceId: string;
  tenantId: string;
  chunkIds: string[];
};

export type IngestJobName = "crawl-website" | "parse-file" | "ping";
export type IngestJobData = CrawlWebsiteJobData | ParseFileJobData | PingJobData;

export type EmbedJobName = "embed-batch";
export type EmbedJobData = EmbedBatchJobData;

/**
 * Default job options shared across producers. 5 attempts with exponential
 * backoff (base 30 s) absorbs transient 5xx, rate limits, and network
 * blips. Permanent failures throw a typed PermanentError that the worker
 * recognizes and short-circuits before any retry — see workers/ingest.ts.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 30_000 },
  // Tidy up history so Upstash doesn't fill with old jobs.
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

// Module-scope singletons — one per process. Both web (Server Actions)
// and worker processes import these.
export const ingestQueue = new Queue<IngestJobData, unknown, IngestJobName>(
  INGEST_QUEUE_NAME,
  { connection: createRedisConnection() },
);

export const embedQueue = new Queue<EmbedJobData, unknown, EmbedJobName>(
  EMBED_QUEUE_NAME,
  { connection: createRedisConnection() },
);
