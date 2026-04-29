import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signing + verification for 360dialog webhooks.
 *
 * 360dialog signs each webhook payload with HMAC-SHA256 over the raw
 * request body, sending the result as `X-360DIALOG-Signature: sha256=<hex>`.
 * Verification recomputes the HMAC against the stored channel secret and
 * compares the two values constant-time to avoid leaking validity via
 * response timing.
 *
 * Standing rule (CLAUDE.md §6 webhook security): the route handler must
 * read `req.text()` exactly once and pass that string here — re-stringifying
 * the parsed JSON produces a different byte sequence and the HMAC fails.
 *
 * In stub mode the same path is exercised: StubWhatsAppClient and the
 * dev-only simulator route both sign with the channel's stored
 * webhookSecret using `signWhatsAppPayload`, and the route verifies via
 * `verifyWhatsAppSignature`. No bypass for stubs — the verification logic
 * gets exercised in dev exactly as it will in prod, so signature regressions
 * surface immediately instead of waiting for production traffic.
 */

const SIGNATURE_PREFIX = "sha256=";

/**
 * Sign a raw payload string with HMAC-SHA256. Returns the value to set in
 * the X-360DIALOG-Signature header (i.e. with the "sha256=" prefix).
 */
export function signWhatsAppPayload(args: {
  rawBody: string;
  secret: string;
}): string {
  const { rawBody, secret } = args;
  const mac = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return SIGNATURE_PREFIX + mac;
}

/**
 * Verify an inbound signature header against the stored channel secret.
 * Returns true on match. Constant-time on the hash bytes — never branches
 * on hash content — so an attacker can't probe for a valid signature one
 * byte at a time via response timing.
 */
export function verifyWhatsAppSignature(args: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): boolean {
  const { rawBody, signatureHeader, secret } = args;
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  const expected = signWhatsAppPayload({ rawBody, secret });

  // timingSafeEqual throws on length mismatch — the early length check
  // here is itself constant-time relative to header content (just two
  // string lengths) and guards against the throw. We compare the FULL
  // header (including "sha256=" prefix) so a forged header that omits
  // the prefix is rejected at the startsWith check above, and any
  // forged hex of the wrong length is rejected here.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
