import "server-only";
import { UnrecoverableError } from "bullmq";

/**
 * Permanent ingestion error — extends BullMQ's UnrecoverableError so the
 * worker treats it as terminal and skips remaining retry attempts. Use for
 * 4xx responses (bad URL, auth, etc.) and other client-side mistakes that
 * will fail identically on retry. Transient failures (5xx, 429, network,
 * AbortError) must throw plain `Error` so BullMQ retries them.
 */
export class PermanentError extends UnrecoverableError {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}
