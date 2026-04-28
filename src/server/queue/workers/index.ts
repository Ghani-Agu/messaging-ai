import "server-only";
import { startEmbedWorker } from "./embed";
import { startIngestWorker } from "./ingest";

/**
 * Boot all workers. Returns a closer that drains in-flight jobs and
 * shuts the connections down — the worker entry script wires this to
 * SIGTERM / SIGINT for graceful Railway deploys.
 */
export function startWorkers(): { close: () => Promise<void> } {
  const ingest = startIngestWorker();
  const embed = startEmbedWorker();
  console.log("[worker] started 2 workers (ingest, embed)");

  return {
    close: async () => {
      console.log("[worker] shutting down...");
      await Promise.allSettled([ingest.close(), embed.close()]);
      console.log("[worker] shutdown complete");
    },
  };
}
