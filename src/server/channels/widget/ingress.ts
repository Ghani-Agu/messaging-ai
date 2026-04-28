import "server-only";
import type { Channel } from "@prisma/client";
import { getChannelByWidgetPublicKey } from "@/server/db/channels";
import { evaluateCors, corsHeaders } from "./cors";
import {
  checkRateLimit,
  resolveLimitsForChannel,
} from "./rate-limit";

/**
 * Single entry point a widget route calls before doing anything tenant-
 * specific. Resolves publicKey → Channel, checks status, evaluates CORS,
 * checks the rate limit. Returns either a ready-to-return failure
 * Response or the resolved Channel + CORS headers the route attaches to
 * its 2xx response.
 *
 * Order of checks (matters for security):
 *   1. publicKey present + valid format → else 401.
 *   2. getChannelByWidgetPublicKey → else 401 (don't leak whether the
 *      key exists, just that auth failed).
 *   3. CORS evaluated against the resolved channel → else 403 with no
 *      ACAO header (browser refuses to surface the response).
 *   4. Channel status: CONNECTED → proceed; DISCONNECTED/ERROR → 503
 *      with a distinct error code so the widget renders the right
 *      banner (offline vs connection-lost).
 *   5. Rate limit → else 429 with Retry-After.
 *
 * Step 1 short-circuits without touching Redis or Prisma. Step 5 hits
 * Redis exactly once (the Lua script does both windows in one
 * round-trip). Step 4 happens before step 5 deliberately: a paused
 * channel shouldn't burn rate-limit budget on its rejected requests.
 */

const WIDGET_ALLOW_METHODS = ["POST", "OPTIONS"];
const WIDGET_ALLOW_HEADERS = ["Content-Type"];
const PAUSED_RETRY_AFTER_SEC = 60;

export type IngressFailure = { kind: "fail"; response: Response };
export type IngressSuccess = {
  kind: "ok";
  channel: Channel;
  corsHeaders: Headers;
};
export type IngressResult = IngressFailure | IngressSuccess;

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Headers,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

export async function authenticateAndAuthorize(args: {
  publicKey: string | null;
  requestOrigin: string | null;
}): Promise<IngressResult> {
  // 1. publicKey present + format-valid (the regex check is inside
  //    getChannelByWidgetPublicKey, which short-circuits to null on
  //    malformed input).
  if (!args.publicKey) {
    return { kind: "fail", response: jsonResponse(401, { error: "unknown_key" }) };
  }
  // 2. Resolve the channel. Returns regardless of status — we
  //    differentiate paused-vs-unknown below.
  const channel = await getChannelByWidgetPublicKey(args.publicKey);
  if (!channel) {
    return { kind: "fail", response: jsonResponse(401, { error: "unknown_key" }) };
  }

  // 3. CORS. Evaluated before status so an attacker who guesses a paused
  //    key doesn't even get to learn its state from a different origin.
  const verdict = evaluateCors({
    requestOrigin: args.requestOrigin,
    channel,
  });
  if (!verdict.ok) {
    // No ACAO header on failure — the browser will block the response.
    return {
      kind: "fail",
      response: jsonResponse(verdict.status, { error: verdict.reason }),
    };
  }
  const cors = corsHeaders({
    verdict,
    allowMethods: WIDGET_ALLOW_METHODS,
    allowHeaders: WIDGET_ALLOW_HEADERS,
  });

  // 4. Channel status. Distinct error code for the widget's banner switch.
  if (channel.status !== "CONNECTED") {
    const headers = new Headers(cors);
    headers.set("Retry-After", String(PAUSED_RETRY_AFTER_SEC));
    return {
      kind: "fail",
      response: jsonResponse(
        503,
        { error: "channel_paused", retryAfterSec: PAUSED_RETRY_AFTER_SEC },
        headers,
      ),
    };
  }

  // 5. Rate limit.
  const limits = resolveLimitsForChannel(channel);
  const rl = await checkRateLimit({ channelId: channel.id, limits });
  if (!rl.ok) {
    const headers = new Headers(cors);
    headers.set("Retry-After", String(rl.retryAfterSec));
    return {
      kind: "fail",
      response: jsonResponse(
        429,
        {
          error: "rate_limited",
          limit: rl.limited,
          retryAfterSec: rl.retryAfterSec,
        },
        headers,
      ),
    };
  }

  return { kind: "ok", channel, corsHeaders: cors };
}

/** Helpers re-exported so the route can build its OPTIONS handler. */
export { handleCorsPreflight } from "./cors";
export {
  WIDGET_ALLOW_METHODS as widgetAllowMethods,
  WIDGET_ALLOW_HEADERS as widgetAllowHeaders,
};
