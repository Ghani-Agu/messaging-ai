import "server-only";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { setTimeout as sleep } from "node:timers/promises";
import { createRedisConnection } from "../connection";
import {
  INGEST_QUEUE_NAME,
  type CrawlWebsiteJobData,
  type IngestJobData,
  type IngestJobName,
  type ParseFileJobData,
  type PingJobData,
} from "../queues";
import { enqueueEmbedBatches } from "../jobs";
import {
  appendSourceLog,
  chunkExistsForSource,
  countTenantChunks,
  flagSoftCapReached,
  insertChunksWithoutEmbeddings,
  listUnembeddedChunkIdsForSource,
  maybeMarkSourceReady,
  updateSourceStatus,
} from "@/server/db/knowledge";
import { chunkMarkdown } from "@/server/knowledge/chunker";
import {
  fetchCrawlPages,
  getCrawlStatus,
  startCrawl,
} from "@/server/knowledge/crawler";
import { MAX_CHUNKS_PER_TENANT } from "@/server/knowledge/limits";

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

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handlePing(job: Job<PingJobData, unknown, "ping">): Promise<{ pong: string; ts: number }> {
  console.log(`[ingest] ping nonce=${job.data.nonce}`);
  return { pong: job.data.nonce, ts: Date.now() };
}

async function handleCrawlWebsite(
  job: Job<CrawlWebsiteJobData, unknown, "crawl-website">,
): Promise<{ chunkCount: number }> {
  const { sourceId, tenantId, rootUrl } = job.data;
  try {
    return await runCrawlWebsite({ sourceId, tenantId, rootUrl });
  } catch (err) {
    await reportFailure(job, sourceId, err);
    throw err;
  }
}

async function handleParseFile(
  _job: Job<ParseFileJobData, unknown, "parse-file">,
): Promise<unknown> {
  // Wired up in step 6.
  throw new Error("parse-file handler not implemented yet (Phase 3, step 6)");
}

// ─────────────────────────────────────────────────────────────────────────────
// runCrawlWebsite — the actual pipeline
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 7 * 60 * 1000; // < lockDuration (10 min) by 3 min slack

async function runCrawlWebsite(args: {
  sourceId: string;
  tenantId: string;
  rootUrl: string;
}): Promise<{ chunkCount: number }> {
  const { sourceId, tenantId, rootUrl } = args;
  await updateSourceStatus({ sourceId, status: "PROCESSING", error: null });

  // Idempotency (blocking revision #1): if chunk rows already exist for
  // this source, this is a retry after a crash mid-pipeline. Skip the
  // re-crawl and re-insert — only enqueue embeds for the remainder.
  if (await chunkExistsForSource(sourceId)) {
    const unembedded = await listUnembeddedChunkIdsForSource(sourceId);
    await appendSourceLog({
      sourceId,
      level: "info",
      text: `Resuming: ${unembedded.length} chunks awaiting embeddings`,
    });
    if (unembedded.length === 0) {
      await maybeMarkSourceReady(sourceId);
      return { chunkCount: 0 };
    }
    await enqueueEmbedBatches({ sourceId, tenantId, chunkIds: unembedded });
    return { chunkCount: 0 };
  }

  await appendSourceLog({ sourceId, level: "info", text: `Crawling ${rootUrl}` });
  const { jobId: firecrawlId } = await startCrawl({ url: rootUrl });

  // Poll loop with progress updates.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("Firecrawl polling timed out after 7 minutes");
    }
    const status = await getCrawlStatus(firecrawlId);
    await updateSourceStatus({
      sourceId,
      progress: {
        pagesCrawled: status.pagesCrawled,
        totalPages: status.totalPages,
      },
    });
    if (status.state === "completed") break;
    if (status.state === "failed") {
      throw new UnrecoverableError(
        status.error ?? "Firecrawl reported failure",
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const pages = await fetchCrawlPages(firecrawlId);
  if (pages.length === 0) {
    throw new UnrecoverableError(
      "Firecrawl returned 0 pages — verify the URL is publicly reachable",
    );
  }
  await appendSourceLog({
    sourceId,
    level: "info",
    text: `Crawled ${pages.length} pages — chunking`,
  });

  const chunks = pages.flatMap((page) =>
    chunkMarkdown({
      content: page.markdown,
      sourceUrl: page.url,
      initialHeadingPath: page.title ? [page.title] : [],
    }),
  );

  // Soft cap (revision #4 + locked decision): warn but don't block.
  const projected = (await countTenantChunks(tenantId)) + chunks.length;
  if (projected > MAX_CHUNKS_PER_TENANT) {
    await flagSoftCapReached(sourceId);
    await appendSourceLog({
      sourceId,
      level: "info",
      text: `Soft cap warning: tenant projected at ${projected}/${MAX_CHUNKS_PER_TENANT} chunks`,
    });
  }

  const { chunkIds } = await insertChunksWithoutEmbeddings({
    tenantId,
    sourceId,
    chunks,
  });
  await updateSourceStatus({
    sourceId,
    progress: {
      pagesCrawled: pages.length,
      totalPages: pages.length,
      totalChunks: chunkIds.length,
      chunksEmbedded: 0,
    },
  });
  await appendSourceLog({
    sourceId,
    level: "info",
    text: `Embedding ${chunkIds.length} chunks`,
  });
  await enqueueEmbedBatches({ sourceId, tenantId, chunkIds });

  return { chunkCount: chunkIds.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure plumbing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BullMQ semantics: `attemptsMade` reflects the *current* attempt count
 * (1-indexed). When it equals `opts.attempts`, this was the last try and
 * the source must transition to ERROR. Earlier attempts log a transient
 * note so the user sees the worker is still trying.
 */
async function reportFailure(
  job: Job<unknown, unknown, string>,
  sourceId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = job.opts.attempts ?? 1;
  const isFinal = err instanceof UnrecoverableError || job.attemptsMade >= attempts;
  if (isFinal) {
    await updateSourceStatus({ sourceId, status: "ERROR", error: message });
    await appendSourceLog({ sourceId, level: "err", text: message });
  } else {
    await appendSourceLog({
      sourceId,
      level: "err",
      text: `Attempt ${job.attemptsMade}/${attempts} failed (will retry): ${message}`,
    });
  }
}
