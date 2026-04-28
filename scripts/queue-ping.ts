/**
 * End-to-end queue health check. Enqueues a `ping` job on the `ingest`
 * queue and waits for a worker process to complete it.
 *
 * Usage (in two terminals):
 *
 *   # Terminal 1
 *   npm run worker
 *
 *   # Terminal 2
 *   npm run queue:ping
 *
 * If the worker is not running, this script blocks until it is — or
 * until the explicit timeout fires.
 */

import { QueueEvents } from "bullmq";
import { createRedisConnection } from "@/server/queue/connection";
import { ingestQueue, INGEST_QUEUE_NAME } from "@/server/queue/queues";

const TIMEOUT_MS = 30_000;

async function main() {
  const events = new QueueEvents(INGEST_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  await events.waitUntilReady();

  const nonce = `ping-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[queue:ping] enqueueing nonce=${nonce}`);
  const job = await ingestQueue.add("ping", { nonce });

  try {
    const result = await job.waitUntilFinished(events, TIMEOUT_MS);
    console.log(`[queue:ping] ✓ result:`, result);
  } finally {
    await events.close();
    await ingestQueue.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[queue:ping] ✗ failed:", err);
    process.exit(1);
  });
