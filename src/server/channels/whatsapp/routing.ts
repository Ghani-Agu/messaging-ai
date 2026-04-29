import "server-only";
import type { Channel } from "@prisma/client";
import { getChannelByWhatsAppPhoneNumberId } from "@/server/db/channels";

/**
 * Webhook routing — phone_number_id → Channel.
 *
 * The route handler must call `extractPhoneNumberId` BEFORE the full
 * Zod parse so we can resolve the channel and load its webhookSecret
 * for HMAC verification. The full structured parse runs only AFTER
 * the signature passes (otherwise an attacker could probe parser
 * shapes via 4xx responses).
 *
 * Defensive read: tolerates any malformed shape and returns null.
 * The handler 404s on null with no signature check, so we never leak
 * channel existence via timing.
 */

export function extractPhoneNumberId(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object") return null;
  const e = envelope as Record<string, unknown>;
  const entry = e.entry;
  if (!Array.isArray(entry)) return null;
  for (const en of entry) {
    if (!en || typeof en !== "object") continue;
    const changes = (en as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      if (!c || typeof c !== "object") continue;
      const value = (c as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      const meta = (value as Record<string, unknown>).metadata;
      if (!meta || typeof meta !== "object") continue;
      const phoneNumberId = (meta as Record<string, unknown>).phone_number_id;
      if (typeof phoneNumberId === "string" && phoneNumberId.length > 0) {
        return phoneNumberId;
      }
    }
  }
  return null;
}

export async function resolveWhatsAppChannelFromEnvelope(
  envelope: unknown,
): Promise<Channel | null> {
  const phoneNumberId = extractPhoneNumberId(envelope);
  if (!phoneNumberId) return null;
  return getChannelByWhatsAppPhoneNumberId(phoneNumberId);
}
