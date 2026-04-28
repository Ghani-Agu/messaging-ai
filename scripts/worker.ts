/**
 * Worker entry. Run via `npm run worker`. Imports server-only modules, so
 * the npm script invokes tsx with `--conditions=react-server` to make the
 * `server-only` package resolve to its no-op build.
 */

import { startWorkers } from "@/server/queue/workers";

const { close } = startWorkers();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}`);
  try {
    await close();
    process.exit(0);
  } catch (err) {
    console.error("[worker] error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
