import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signing + verification for Meta Graph API webhooks.
 *
 * Meta signs each webhook payload with HMAC-SHA256 over the raw request
 * body, sending the result as `X-Hub-Signature-256: sha256=<hex>`.
 * Verification recomputes the HMAC against `META_APP_SECRET` (env var,
 * GLOBAL across all Pages and IG accounts on the Meta app) and compares
 * the two values constant-time.
 *
 * Phase 7 deviation from Phase 6's per-channel-secret pattern: because
 * the secret is global, the webhook handler can verify HMAC BEFORE
 * resolving the channel from the payload's pageId / igUserId. The
 * Phase 6 rule "404 on unknown routing key, no signature check on
 * lookup miss" applied because the secret was per-channel; here it
 * doesn't, since the HMAC is uniform regardless of which channel a
 * payload routes to. CLAUDE.md §6 will document the addendum in 7g.
 *
 * Standing rule (CLAUDE.md §6): the route handler must read
 * `req.text()` exactly once and pass that string here — re-stringifying
 * the parsed JSON produces a different byte sequence and the HMAC
 * fails.
 *
 * In stub mode the same path is exercised: StubMessengerClient and
 * StubInstagramClient both sign delivery callbacks with the value
 * returned by `getMetaAppSecret()` (real env secret in dev/prod, or a
 * deterministic fallback when env-unset in dev). The webhook handler
 * verifies via the same path. No bypass for stubs.
 */

const SIGNATURE_PREFIX = "sha256=";

/**
 * Sign a raw payload string with HMAC-SHA256. Returns the value to set
 * in the X-Hub-Signature-256 header (i.e. with the "sha256=" prefix).
 */
export function signMetaPayload(args: {
  rawBody: string;
  secret: string;
}): string {
  const mac = createHmac("sha256", args.secret)
    .update(args.rawBody, "utf8")
    .digest("hex");
  return SIGNATURE_PREFIX + mac;
}

/**
 * Verify an inbound signature header against the supplied secret.
 * Returns true on match. Constant-time on the hash bytes; never branches
 * on hash content. Handles missing / malformed headers safely.
 *
 * The secret parameter is supplied by the caller — typically
 * `getMetaAppSecret()` for both the webhook handler and the stub
 * delivery-callback fire path. Channel-agnostic per Gate 1.
 */
export function verifyMetaSignature(args: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): boolean {
  const { rawBody, signatureHeader, secret } = args;
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  const expected = signMetaPayload({ rawBody, secret });

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Env secret accessor — single source of truth for the Meta app secret
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed development fallback used when `META_APP_SECRET` isn't set.
 * Public string by design — it lets the stub clients and the webhook
 * handler agree on a value in dev without anyone having to set the
 * env var. SECURITY: the production accessor below throws if env is
 * unset, so this fallback never runs in prod.
 */
export const STUB_META_APP_SECRET = "stub-meta-app-secret-dev";

/**
 * Resolve the Meta app secret. Order:
 *   1. process.env.META_APP_SECRET if set → real value.
 *   2. NODE_ENV === "production" with no env value → throw. Keeps the
 *      stub fallback from ever silently matching forged signatures
 *      against a leaked-codebase value.
 *   3. Otherwise (dev/test) → STUB_META_APP_SECRET, with a one-time
 *      console warning.
 *
 * Stub clients and the webhook handler both call this — same path,
 * same secret, no bypass.
 */
let warnedAboutFallback = false;

export function getMetaAppSecret(): string {
  const envSecret = process.env.META_APP_SECRET;
  if (envSecret && envSecret.length > 0) return envSecret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "META_APP_SECRET is not set — required in production. The stub fallback is dev-only.",
    );
  }
  if (!warnedAboutFallback) {
    console.warn(
      "[meta] META_APP_SECRET not set — using stub-meta-app-secret-dev. Set the env var before going live.",
    );
    warnedAboutFallback = true;
  }
  return STUB_META_APP_SECRET;
}

/** Test-only — resets the one-time warn flag so each test sees a fresh state. */
export function _resetMetaAppSecretWarnFlagForTests(): void {
  warnedAboutFallback = false;
}
