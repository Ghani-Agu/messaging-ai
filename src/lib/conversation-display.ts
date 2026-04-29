import type { ChannelType } from "@prisma/client";

/**
 * Pure projection helpers for conversation rendering — keeps the formatting
 * rules in one testable place and out of the React component bodies.
 *
 * The dashboard renders conversations across four channel types
 * (WIDGET / WHATSAPP / MESSENGER / INSTAGRAM). Each one has a slightly
 * different shape for the customer's identity:
 *
 *   - WIDGET   → externalId is "widget:<browser-uuid>", customer.name
 *                usually null until the embed surface collects one.
 *   - WHATSAPP → externalId is the customer's wa_id (digits, no '+'),
 *                customer.phone may be present in E.164. Profile name
 *                comes from contacts[].profile.name on first inbound.
 *   - MESSENGER → externalId is the PSID (Page-Scoped ID, ~10-15 digits).
 *                customer.name comes from synchronous getProfile in the
 *                7c webhook ingress.
 *   - INSTAGRAM → externalId is the IGSID (Instagram-Scoped ID).
 *                customer.name comes from the same getProfile path,
 *                preferring @username over display name.
 *
 * Two helpers consumers care about:
 *
 *   - customerDisplayLabel — what to put in the H1 of the detail header
 *     and the row title in the list. Falls back to a channel-shaped
 *     prefix (PSID: / IGSID:) when no name is on file so operators can
 *     still tell threads apart.
 *
 *   - buildConversationHeaderMetadata — what to put in the subline
 *     beneath the H1: channel display name vs channel-side identity
 *     (Page name, @username, phone). Reads from Channel.config for
 *     Messenger and Instagram since that's where the operator-confirmed
 *     pageName / igUsername lives.
 */

const META_EXTERNAL_ID_TRUNCATE = 12;

function truncateExternalId(id: string): string {
  if (id.length <= META_EXTERNAL_ID_TRUNCATE) return id;
  return `${id.slice(0, META_EXTERNAL_ID_TRUNCATE)}…`;
}

/**
 * The customer's display label — first preference is the stored name
 * (set by the per-channel webhook on first inbound). When that's null,
 * we fall back to a channel-specific identifier prefix:
 *
 *   - MESSENGER → "PSID: 1234567890"        (truncates if PSID is long)
 *   - INSTAGRAM → "IGSID: 987654321…"
 *   - WIDGET    → "widget:abcdef0123456789…" (existing widget format)
 *   - WHATSAPP  → raw externalId (the wa_id digits)
 */
export function customerDisplayLabel(args: {
  name: string | null;
  externalId: string;
  channelType: ChannelType;
}): string {
  if (args.name && args.name.length > 0) return args.name;

  switch (args.channelType) {
    case "MESSENGER":
      return `PSID: ${truncateExternalId(args.externalId)}`;
    case "INSTAGRAM":
      return `IGSID: ${truncateExternalId(args.externalId)}`;
    case "WIDGET":
    case "WHATSAPP":
    default: {
      // Existing list-row logic preserved for backward compatibility —
      // widget UUIDs are 36+ chars; truncating at 24 keeps the row tidy
      // while leaving the "widget:" namespace prefix readable.
      const id = args.externalId;
      if (id.length <= 24) return id;
      return `${id.slice(0, 22)}…`;
    }
  }
}

/**
 * Single-character avatar initial. Prefers the first character of the
 * customer's name; falls back to the first character past any
 * `namespace:` prefix in the externalId. Returns "?" when nothing
 * usable is available (e.g. a freshly-created widget customer with
 * just `widget:`).
 */
export function customerInitial(args: {
  name: string | null;
  externalId: string;
}): string {
  if (args.name && args.name.length > 0) {
    return args.name.charAt(0).toUpperCase();
  }
  const id = args.externalId;
  const colonIdx = id.indexOf(":");
  const candidate = colonIdx >= 0 ? id.slice(colonIdx + 1) : id;
  return candidate.charAt(0).toUpperCase() || "?";
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail-header subline metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two pieces of channel-side context shown next to the channel icon in
 * the conversation detail header. `channelLabel` is the primary string
 * (display name, Page name, or @username); `contextLabel` is an
 * additional identifier (phone, raw external id) — null if there's
 * nothing useful to show.
 */
export type ConversationHeaderMetadata = {
  channelLabel: string;
  contextLabel: string | null;
};

/**
 * Project the (channel + customer) pair into header subline metadata.
 *
 *   - WHATSAPP  → operator's display name + customer phone (E.164 if on
 *                 file, else the wa_id digits as fallback).
 *   - MESSENGER → Page name from Channel.config.pageName (the
 *                 operator-confirmed Meta-side name) + customer PSID.
 *                 Falls back to the operator's display name if config
 *                 is malformed.
 *   - INSTAGRAM → @username from Channel.config.igUsername + customer
 *                 IGSID. Falls back similarly.
 *   - WIDGET    → operator's display name + raw external id.
 */
export function buildConversationHeaderMetadata(args: {
  channelType: ChannelType;
  channelDisplayName: string;
  channelConfig: unknown;
  customerPhone: string | null;
  customerExternalId: string;
}): ConversationHeaderMetadata {
  switch (args.channelType) {
    case "WHATSAPP":
      return {
        channelLabel: args.channelDisplayName,
        contextLabel: args.customerPhone ?? args.customerExternalId,
      };
    case "MESSENGER": {
      const pageName = readJsonString(args.channelConfig, "pageName");
      return {
        channelLabel: pageName ?? args.channelDisplayName,
        contextLabel: `PSID: ${truncateExternalId(args.customerExternalId)}`,
      };
    }
    case "INSTAGRAM": {
      const igUsername = readJsonString(args.channelConfig, "igUsername");
      return {
        channelLabel: igUsername
          ? `@${igUsername}`
          : args.channelDisplayName,
        contextLabel: `IGSID: ${truncateExternalId(args.customerExternalId)}`,
      };
    }
    case "WIDGET":
    default:
      return {
        channelLabel: args.channelDisplayName,
        contextLabel: args.customerExternalId,
      };
  }
}

/**
 * Defensive read of a string field off an unknown JSON value. Used to
 * project Channel.config (Prisma JsonValue) without coupling display
 * helpers to the validators module — a malformed config row just falls
 * through to the channel.displayName fallback rather than crashing.
 */
function readJsonString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
