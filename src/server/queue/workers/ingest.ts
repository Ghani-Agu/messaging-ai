import "server-only";
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../connection";
import {
  INGEST_QUEUE_NAME,
  type CrawlWebsiteJobData,
  type IngestJobData,
  type IngestJobName,
  type ParseFileJobData,
  type PingJobData,
} from "../queues";

/**
 * Worker for the `ingest` queue. Routes by job.name and only runs one job
 * at a time per process — Firecrawl/LlamaParse polls are I/O-bound but the
 * downstream chunking + embed-enqueue work isn't worth parallelizing inside
 * one worker process when we can scale by adding processes instead.
 *
 * Lock options come from the project lead's blocking revision: long
 * Firecrawl polls can stall the job for several minutes, and the default
 * 30 s lock would expire mid-poll and let BullMQ re-deliver the job to
 * another worker, causing duplicate work.
 */
export function startIngestWorker(): Worker<IngestJobData, unknown, IngestJobName> {
  const worker = new Worker<IngestJobData, unknown, IngestJobName>(
    INGEST_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case "ping":
          return handlePing(job as Job<PingJobData, unknown, "ping">);
        case "crawl-website":
          return handleCrawlWebsite(
            job as Job<CrawlWebsiteJobData, unknown, "crawl-website">,
          );
        case "parse-file":
          return handleParseFile(
            job as Job<ParseFileJobData, unknown, "parse-file">,
          );
        default: {
          // Exhaustiveness: any new IngestJobName must add a case above.
          const exhaustive: never = job.name;
          throw new Error(`unhandled ingest job name: ${String(exhaustive)}`);
        }
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
      lockDuration: 10 * 60 * 1000, // 10 min — covers long Firecrawl polls
      lockRenewTime: 60 * 1000, // renew every 60 s, well under lockDuration
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[ingest] job ${job?.id} (${job?.name}) failed:`, err.message);
  });
  worker.on("error", (err) => {
    console.error("[ingest] worker error:", err.message);
  });
  return worker;
}

async function handlePing(job: Job<PingJobData, unknown, "ping">): Promise<{ pong: string; ts: number }> {
  console.log(`[ingest] ping nonce=${job.data.nonce}`);
  return { pong: job.data.nonce, ts: Date.now() };
}

async function handleCrawlWebsite(
  _job: Job<CrawlWebsiteJobData, unknown, "crawl-website">,
): Promise<unknown> {
  // Wired up in step 5.
  throw new Error("crawl-website handler not implemented yet (Phase 3, step 5)");
}

async function handleParseFile(
  _job: Job<ParseFileJobData, unknown, "parse-file">,
): Promise<unknown> {
  // Wired up in step 6.
  throw new Error("parse-file handler not implemented yet (Phase 3, step 6)");
}
