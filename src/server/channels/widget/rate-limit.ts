import "server-only";
import IORedis from "ioredis";
import type { Channel } from "@prisma/client";
import { widgetRateLimitsSchema } from "@/lib/validators";

/**
 * Per-channel token-bucket rate limiter for the widget endpoint.
 *
 * Two windows enforced together (AND-gated):
 *   - burst:   default 30 events per 60s
 *   - sustain: default 600 events per 3600s
 * Both must allow the request, otherwise 429 with Retry-After from the
 * failing window's TTL.
 *
 * Keying: Channel.id. Per-IP keying would let rotating-IP attackers
 * starve a legitimate widget; per-customer is too granular and would
 * 429 a single anxious customer's stream of messages. Channel.id is
 * the abuse boundary the operator controls.
 *
 * Phase-9 billing-tier seam:
 *   resolveLimitsForChannel(channel) reads any per-channel override
 *   stored at channel.config.rateLimits and falls back to defaults.
 *   When Phase 9 introduces plan-tier limits, *only this function*
 *   changes — every call site already routes through it. Callers
 *   pass the resolved limits to checkRateLimit(...) so the limiter
 *   itself stays plan-agnostic.
 *
 * AI replies are NOT counted against the bucket — the limiter sees
 * inbound events only. Counting outbound would let abusive operators
 * starve their own customers (one inbound triggers one AI reply, and
 * doubling the count halves the effective budget for free).
 */

export type RateLimitWindow = {
  /** Window length in seconds. */
  windowSec: number;
  /** Max events allowed within the window. */
  capacity: number;
};

export type RateLimits = {
  burst: RateLimitWindow;
  sustain: RateLimitWindow;
};

export const WIDGET_RATE_LIMIT_DEFAULTS: RateLimits = {
  burst: { windowSec: 60, capacity: 30 },
  sustain: { windowSec: 3600, capacity: 600 },
};

/**
 * Resolve effective limits for a channel. Phase-6 reads only the
 * channel override + defaults; Phase 9 will add a plan-tier branch
 * here without touching call sites.
 */
export function resolveLimitsForChannel(channel: Channel): RateLimits {
  const parsed = widgetRateLimitsSchema.safeParse(
    (channel.config as { rateLimits?: unknown } | null)?.rateLimits,
  );
  const override = parsed.success ? parsed.data : null;
  return {
    burst: override?.burst ?? WIDGET_RATE_LIMIT_DEFAULTS.burst,
    sustain: override?.sustain ?? WIDGET_RATE_LIMIT_DEFAULTS.sustain,
  };
}

export type RateLimitVerdict =
  | { ok: true; remaining: { burst: number; sustain: number } }
  | { ok: false; retryAfterSec: number; limited: "burst" | "sustain" };

// ─────────────────────────────────────────────────────────────────────────────
// Lua script (atomic check-and-increment for both windows)
//
// KEYS[1] = burst counter key       (wgt:rl:b:{channelId})
// KEYS[2] = sustain counter key     (wgt:rl:s:{channelId})
// ARGV[1] = burst windowSec
// ARGV[2] = burst capacity
// ARGV[3] = sustain windowSec
// ARGV[4] = sustain capacity
//
// Both INCRs and EXPIREs run in a single Redis round-trip so the burst
// and sustain counters can never get out of step (which would let one
// window pass while the other just-tipped).
//
// On limit hit we DON'T decrement. The bucket counts attempts, not
// successes — otherwise an attacker who ignores 429s could spam past
// the budget. The mild "consumed slots even on 429" effect is
// desirable: it limits 429-flooding under sustained abuse.
//
// Returns:
//   { 1, remainingBurst, remainingSustain }   on allow
//   { 0, "burst"|"sustain", retryAfterSec }   on deny
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_LUA = `
local b = redis.call("INCR", KEYS[1])
if b == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
local s = redis.call("INCR", KEYS[2])
if s == 1 then redis.call("EXPIRE", KEYS[2], ARGV[3]) end

local bcap = tonumber(ARGV[2])
local scap = tonumber(ARGV[4])

if b > bcap then
  local ttl = redis.call("PTTL", KEYS[1])
  return {0, "burst", math.max(1, math.ceil(ttl / 1000))}
end
if s > scap then
  local ttl = redis.call("PTTL", KEYS[2])
  return {0, "sustain", math.max(1, math.ceil(ttl / 1000))}
end

return {1, bcap - b, scap - s}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Redis singleton (lazy)
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __widgetRlClient: IORedis | undefined;
}

function getClient(): IORedis {
  if (globalThis.__widgetRlClient) return globalThis.__widgetRlClient;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  const client = new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  // ioredis caches the script SHA1; first call EVAL, subsequent calls
  // EVALSHA. Falls back to EVAL on NOSCRIPT (Redis cache flush).
  client.defineCommand("widgetRateLimit", {
    numberOfKeys: 2,
    lua: RATE_LIMIT_LUA,
  });
  globalThis.__widgetRlClient = client;
  return client;
}

// ioredis adds dynamically-defined commands to the prototype at runtime;
// re-declare the type so callers don't see `any`.
type RedisWithRateLimit = IORedis & {
  widgetRateLimit(
    burstKey: string,
    sustainKey: string,
    burstWindowSec: number,
    burstCapacity: number,
    sustainWindowSec: number,
    sustainCapacity: number,
  ): Promise<[number, string | number, number]>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomic check-and-increment of both rate-limit windows. Returns the
 * verdict; the caller (ingress.ts) decides what HTTP response to emit.
 */
export async function checkRateLimit(args: {
  channelId: string;
  limits: RateLimits;
}): Promise<RateLimitVerdict> {
  const client = getClient() as RedisWithRateLimit;
  const burstKey = `wgt:rl:b:${args.channelId}`;
  const sustainKey = `wgt:rl:s:${args.channelId}`;
  const [ok, second, third] = await client.widgetRateLimit(
    burstKey,
    sustainKey,
    args.limits.burst.windowSec,
    args.limits.burst.capacity,
    args.limits.sustain.windowSec,
    args.limits.sustain.capacity,
  );
  if (ok === 1) {
    return {
      ok: true,
      remaining: {
        burst: Number(second),
        sustain: Number(third),
      },
    };
  }
  return {
    ok: false,
    limited: second === "burst" ? "burst" : "sustain",
    retryAfterSec: Number(third),
  };
}
