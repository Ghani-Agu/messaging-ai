import "server-only";
import type { Channel } from "@prisma/client";
import {
  canonicalizeOrigin,
  parseWidgetChannelConfig,
} from "@/lib/validators";

/**
 * CORS policy for widget endpoints. Locked at Phase-6 Gate 1:
 *
 *   - No wildcards. Access-Control-Allow-Origin echoes the request
 *     Origin iff it's permitted; otherwise no ACAO header is sent
 *     (browsers block the response).
 *   - No credentials. We never send cookies; widget auth lives in
 *     the request body (publicKey + customerExternalId).
 *   - Missing Origin → 403. Server-to-server probes have no business
 *     here; legitimate browsers always send Origin on cross-origin
 *     POSTs. (CLAUDE.md §6 follow-up: revisit if same-origin
 *     deployment ever becomes real — probably never.)
 *
 * Allowlist source: Channel.config.originsAllowlist. Empty array =
 * any origin permitted (v1 default; Phase 9 adds plan-tier
 * enforcement).
 */

export type CorsVerdict =
  | { ok: true; mirrorOrigin: string }
  | {
      ok: false;
      status: 403;
      reason: "missing_origin" | "origin_not_allowed";
    };

export function evaluateCors(args: {
  requestOrigin: string | null;
  channel: Channel;
}): CorsVerdict {
  const { requestOrigin, channel } = args;
  if (!requestOrigin) return { ok: false, status: 403, reason: "missing_origin" };

  let canonical: string;
  try {
    canonical = canonicalizeOrigin(requestOrigin);
  } catch {
    return { ok: false, status: 403, reason: "origin_not_allowed" };
  }

  // Channel.config might not yet be widget-shaped if the row was just
  // upserted with bad data — be tolerant and treat unparseable config as
  // "no allowlist" so the operator can recover by editing the row.
  let allowlist: string[] = [];
  try {
    allowlist = parseWidgetChannelConfig(channel.config).originsAllowlist;
  } catch {
    allowlist = [];
  }

  // Empty allowlist → no restriction in v1.
  if (allowlist.length === 0) return { ok: true, mirrorOrigin: canonical };

  if (allowlist.includes(canonical)) return { ok: true, mirrorOrigin: canonical };
  return { ok: false, status: 403, reason: "origin_not_allowed" };
}

/**
 * Build the CORS headers for a verdict. Returns a Headers object the
 * route can spread into its Response constructor — Response headers in
 * Next.js's runtime are immutable after construction in some paths, so
 * we hand back a Headers instance instead of mutating one in-place.
 */
export function corsHeaders(args: {
  verdict: CorsVerdict;
  allowMethods?: string[];
  allowHeaders?: string[];
  maxAgeSec?: number;
}): Headers {
  const headers = new Headers();
  if (args.verdict.ok) {
    headers.set("Access-Control-Allow-Origin", args.verdict.mirrorOrigin);
    headers.set("Vary", "Origin");
    if (args.allowMethods && args.allowMethods.length > 0) {
      headers.set("Access-Control-Allow-Methods", args.allowMethods.join(", "));
    }
    if (args.allowHeaders && args.allowHeaders.length > 0) {
      headers.set("Access-Control-Allow-Headers", args.allowHeaders.join(", "));
    }
    if (typeof args.maxAgeSec === "number") {
      headers.set("Access-Control-Max-Age", String(args.maxAgeSec));
    }
  }
  // No Access-Control-Allow-Credentials. Ever.
  return headers;
}

/** Build the right OPTIONS response for any widget endpoint. */
export function handleCorsPreflight(args: {
  requestOrigin: string | null;
  channel: Channel;
  allowMethods: string[];
  allowHeaders: string[];
  maxAgeSec?: number;
}): Response {
  const verdict = evaluateCors({
    requestOrigin: args.requestOrigin,
    channel: args.channel,
  });
  if (!verdict.ok) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const headers = corsHeaders({
    verdict,
    allowMethods: args.allowMethods,
    allowHeaders: args.allowHeaders,
    maxAgeSec: args.maxAgeSec ?? 600,
  });
  return new Response(null, { status: 204, headers });
}
