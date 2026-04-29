import "server-only";
import { z } from "zod";
import type { MessageContentType } from "@prisma/client";

/**
 * Webhook payload parsing for 360dialog (Meta-shape).
 *
 * 360dialog forwards Meta's WhatsApp Cloud API webhook envelope verbatim:
 *
 *   { object, entry: [{ id, changes: [{ value, field }] }] }
 *
 * We care about `value` under each change; it carries either inbound
 * messages (with optional contacts) or status updates. One webhook can
 * batch multiple of either; the route handler iterates over both arrays
 * and records each independently.
 *
 * The schema below is permissive — any field we don't model is ignored
 * (`.passthrough()` on the value object), so a future Meta payload
 * extension doesn't break parsing. We extract only what the dashboard /
 * brain need.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Output shapes (what the route handler consumes)
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedInboundMessage = {
  phoneNumberId: string;
  /** Customer's WABA wa_id — the lookup key under (tenantId, channelType, externalId). */
  customerWaId: string;
  /** Customer's phone in E.164 form ("+213..."). wa_id with a leading "+". */
  customerPhoneNumber: string;
  /** Profile name from contacts[].profile.name when present; null otherwise. */
  profileName: string | null;
  /** Provider's message id (wamid.* in production). Used for idempotency. */
  providerMessageId: string;
  /** TEXT body, IMAGE caption (or "[image]"), VOICE/FILE placeholder. */
  content: string;
  contentType: MessageContentType;
  /** For non-TEXT: 360dialog media id (resolves to a URL via /media/<id>). */
  mediaUrl: string | null;
  /** Unix seconds, as forwarded by 360dialog. */
  timestamp: number;
};

export type ParsedStatusUpdate = {
  phoneNumberId: string;
  /** The Message row's providerMessageId is matched against this. */
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: number;
};

export type ParsedWebhook = {
  inbound: ParsedInboundMessage[];
  statuses: ParsedStatusUpdate[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — permissive, only the fields we read are required
// ─────────────────────────────────────────────────────────────────────────────

const messageBaseSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().min(1), // unix seconds as a string
    type: z.string().min(1),
  })
  .passthrough();

const contactSchema = z
  .object({
    wa_id: z.string().min(1),
    profile: z.object({ name: z.string().optional() }).optional(),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["sent", "delivered", "read", "failed"]),
    timestamp: z.string().min(1),
  })
  .passthrough();

const valueSchema = z
  .object({
    messaging_product: z.literal("whatsapp"),
    metadata: z.object({
      phone_number_id: z.string().min(1),
    }),
    contacts: z.array(contactSchema).optional(),
    messages: z.array(messageBaseSchema).optional(),
    statuses: z.array(statusSchema).optional(),
  })
  .passthrough();

const changeSchema = z
  .object({
    value: valueSchema,
  })
  .passthrough();

const entrySchema = z
  .object({
    changes: z.array(changeSchema),
  })
  .passthrough();

const webhookEnvelopeSchema = z
  .object({
    object: z.string().optional(), // "whatsapp_business_account" — informational
    entry: z.array(entrySchema),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Parse + project
// ─────────────────────────────────────────────────────────────────────────────

const TEXT_PLACEHOLDERS: Partial<Record<string, string>> = {
  image: "[image]",
  audio: "[voice message]",
  voice: "[voice message]",
  video: "[video]",
  document: "[document]",
  sticker: "[sticker]",
  location: "[location]",
};

/**
 * Parse + project a Meta-shape webhook payload. Throws on top-level
 * shape errors (object missing entry, malformed metadata, etc.) so the
 * route handler returns 400; per-message issues are absorbed silently
 * (a malformed message in a batch shouldn't tank the batch).
 */
export function parseWhatsAppWebhook(rawJson: unknown): ParsedWebhook {
  const env = webhookEnvelopeSchema.parse(rawJson);
  const inbound: ParsedInboundMessage[] = [];
  const statuses: ParsedStatusUpdate[] = [];

  for (const entry of env.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const phoneNumberId = value.metadata.phone_number_id;

      // Index contacts by wa_id once per change for O(1) lookup per message.
      const contactByWaId = new Map<string, { profileName: string | null }>();
      for (const c of value.contacts ?? []) {
        contactByWaId.set(c.wa_id, {
          profileName: c.profile?.name ?? null,
        });
      }

      for (const msg of value.messages ?? []) {
        const projected = projectMessage(msg, phoneNumberId, contactByWaId);
        if (projected) inbound.push(projected);
      }

      for (const st of value.statuses ?? []) {
        const ts = Number(st.timestamp);
        if (!Number.isFinite(ts)) continue;
        statuses.push({
          phoneNumberId,
          providerMessageId: st.id,
          status: st.status,
          timestamp: ts,
        });
      }
    }
  }

  return { inbound, statuses };
}

function projectMessage(
  msg: z.infer<typeof messageBaseSchema>,
  phoneNumberId: string,
  contactByWaId: Map<string, { profileName: string | null }>,
): ParsedInboundMessage | null {
  const ts = Number(msg.timestamp);
  if (!Number.isFinite(ts)) return null;

  const customerWaId = msg.from;
  const customerPhoneNumber = customerWaId.startsWith("+")
    ? customerWaId
    : `+${customerWaId}`;
  const profileName = contactByWaId.get(customerWaId)?.profileName ?? null;

  // Per-type projection. We unconditionally keep TEXT body; for media
  // types we keep a placeholder + the media id (mediaUrl). The brain
  // doesn't run on non-TEXT in v1 (per MASTER_PLAN §2 — voice messages
  // ship in v1.1) but the dashboard renders them via the contentType.
  const t = msg.type;
  if (t === "text") {
    const body = readTextBody(msg);
    if (body === null) return null;
    return {
      phoneNumberId,
      customerWaId,
      customerPhoneNumber,
      profileName,
      providerMessageId: msg.id,
      content: body,
      contentType: "TEXT",
      mediaUrl: null,
      timestamp: ts,
    };
  }
  if (t === "image" || t === "audio" || t === "voice" || t === "video") {
    const mediaId = readMediaId(msg, t);
    const caption = readMediaCaption(msg, t);
    return {
      phoneNumberId,
      customerWaId,
      customerPhoneNumber,
      profileName,
      providerMessageId: msg.id,
      content: caption ?? TEXT_PLACEHOLDERS[t] ?? `[${t}]`,
      contentType:
        t === "image"
          ? "IMAGE"
          : t === "video"
            ? "FILE" // we don't have a VIDEO contentType in the enum
            : "VOICE",
      mediaUrl: mediaId,
      timestamp: ts,
    };
  }
  if (t === "document") {
    const mediaId = readMediaId(msg, "document");
    const filename = readDocumentFilename(msg);
    return {
      phoneNumberId,
      customerWaId,
      customerPhoneNumber,
      profileName,
      providerMessageId: msg.id,
      content: filename ? `[document: ${filename}]` : "[document]",
      contentType: "FILE",
      mediaUrl: mediaId,
      timestamp: ts,
    };
  }
  // Unhandled type (sticker, location, contacts, interactive, etc.) —
  // keep a minimal placeholder so the dashboard at least shows the row.
  return {
    phoneNumberId,
    customerWaId,
    customerPhoneNumber,
    profileName,
    providerMessageId: msg.id,
    content: TEXT_PLACEHOLDERS[t] ?? `[${t}]`,
    contentType: "TEXT",
    mediaUrl: null,
    timestamp: ts,
  };
}

// Field readers — Meta's payload nests body / id / caption inside
// per-type sub-objects. Permissive: anything malformed → null.

function readTextBody(msg: Record<string, unknown>): string | null {
  const text = msg.text as { body?: unknown } | undefined;
  if (!text || typeof text.body !== "string") return null;
  return text.body;
}

function readMediaId(msg: Record<string, unknown>, key: string): string | null {
  const media = msg[key] as { id?: unknown } | undefined;
  if (!media || typeof media.id !== "string") return null;
  return media.id;
}

function readMediaCaption(
  msg: Record<string, unknown>,
  key: string,
): string | null {
  const media = msg[key] as { caption?: unknown } | undefined;
  if (!media || typeof media.caption !== "string") return null;
  return media.caption.length > 0 ? media.caption : null;
}

function readDocumentFilename(msg: Record<string, unknown>): string | null {
  const doc = msg.document as { filename?: unknown } | undefined;
  if (!doc || typeof doc.filename !== "string") return null;
  return doc.filename;
}
