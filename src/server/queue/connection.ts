import "server-only";
import IORedis from "ioredis";

/**
 * Each Queue, Worker, and QueueEvents instance gets its own ioredis
 * connection from this factory. Sharing one connection across all of them
 * works in BullMQ but is fragile under load — separate connections isolate
 * head-of-line blocking on the BLPOP that workers use internally.
 *
 * Upstash Redis is configured via REDIS_URL using the `rediss://` scheme,
 * which ioredis maps to TLS automatically. BullMQ requires
 * maxRetriesPerRequest=null (otherwise long blocking commands time out)
 * and is happier with enableReadyCheck=false on Upstash.
 */
export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
