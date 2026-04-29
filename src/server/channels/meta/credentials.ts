import "server-only";
import type { Channel } from "@prisma/client";
import {
  decryptCredentials,
  isEncryptedCredentials,
} from "@/server/channels/credentials";
import {
  metaCredentialsSchema,
  type MetaCredentials,
} from "@/lib/validators";

/**
 * Read + decrypt a Meta channel's credentials. Returns a placeholder
 * MetaCredentials object when:
 *
 *   - the channel has no encrypted blob yet (pre-connect-form state:
 *     Channel.credentials = `{}`), or
 *   - the envelope is malformed / decryption fails.
 *
 * The placeholder lets the leaf factory (getMessengerClient /
 * getInstagramClient) still return a Stub client when META_APP_ID is
 * unset — keeping the dispatch path exercisable in dev/test before the
 * connect form lands. In production with a real client constructed
 * against the placeholder token, the actual API call will fail; the
 * caller catches the error and surfaces it (Customer name stays null
 * on inbound, deliveryStatus="failed" on outbound).
 *
 * Shared by:
 *   - src/app/api/meta/webhook/route.ts — getProfile fetcher (Phase 7c).
 *   - src/server/channels/outbound-dispatch.ts — MESSENGER / INSTAGRAM
 *     dispatch arms (Phase 7d).
 */

export const PLACEHOLDER_META_CREDENTIALS: MetaCredentials = {
  pageAccessToken: "stub-placeholder-token",
};

export function readMetaCredentials(channel: Channel): MetaCredentials {
  if (!isEncryptedCredentials(channel.credentials)) {
    return PLACEHOLDER_META_CREDENTIALS;
  }
  try {
    return metaCredentialsSchema.parse(decryptCredentials(channel.credentials));
  } catch (err) {
    console.warn(
      `meta/credentials: failed to decrypt credentials for channel ${channel.id}:`,
      err instanceof Error ? err.message : err,
    );
    return PLACEHOLDER_META_CREDENTIALS;
  }
}
