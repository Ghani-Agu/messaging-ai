import "server-only";
import { z } from "zod";
import type { MessageContentType } from "@prisma/client";

/**
 * Webhook payload parsing for Meta Graph API — Messenger + Instagram DMs.
 *
 * Both products forward Meta's standard webhook envelope:
 *
 *   { object: "page" | "instagram", entry: [{ id, time, messaging: [...] }] }
 *
 * `object: "page"` carries Messenger events (Page DMs); `object: "instagram"`
 * carries Instagram Direct events. The `messaging[]` items have nearly
 * identical shapes for inbound text/attachments + delivery/read events.
 *
 * (Instagram also publishes media/comments/mentions via `entry[].changes[]`
 * with `field: "comments"` etc., but those aren't DMs and Phase 7 v1
 * scopes to messaging only — non-`messaging` shapes are ignored.)
 *
 * Permissive Zod parsing: any field we don't model is ignored
 * (`.passthrough()`), so future Meta payload extensions don't break parsing.
 * Top-level shape errors throw → route handler 400s. Per-message issues
 * are absorbed silently — a malformed message in a batch shouldn't tank
 * the batch (per Phase 6 §6 webhook security checklist rule 7).
 */

export type MetaChannelKind = "messenger" | "instagram";

// ─────────────────────────────────────────────────────────────────────────────
// Output shapes (what the route handler consumes)
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedMetaInbound = {
  channelKind: MetaChannelKind;
  /** Page ID (Messenger) or IG User ID (Instagram). Routes to a Channel via
   *  the partial unique on Channel.config->>'pageId' or 'igUserId'. */
  externalAccountId: string;
  /** Customer's PSID (Messenger) or IGSID (Instagram). The lookup key under
   *  Customer.externalId. */
  customerExternalId: string;
  /** Provider's mid — used for inbound idempotency + outbound delivery
   *  routing. */
  providerMessageId: string;
  /** TEXT body or media-type placeholder. */
  content: string;
  contentType: MessageContentType;
  /** http(s) URL for media attachments — Meta delivers signed CDN URLs
   *  (~24h TTL) directly, no media-id resolution dance like WhatsApp. */
  mediaUrl: string | null;
  /** Unix milliseconds (Meta forwards ms-resolution timestamps). */
  timestamp: number;
};

export type ParsedMetaDeliveryStatus = {
  channelKind: MetaChannelKind;
  externalAccountId: string;
  /** Per-mid; we expand `delivery.mids[]` into one status per mid. */
  providerMessageId: string;
  status: "delivered";
  timestamp: number;
};

export type ParsedMetaWebhook = {
  inbound: ParsedMetaInbound[];
  statuses: ParsedMetaDeliveryStatus[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — permissive, only the fields we read are required
// ─────────────────────────────────────────────────────────────────────────────

const idHolderSchema = z.object({ id: z.string().min(1) }).passthrough();

const attachmentPayloadSchema = z
  .object({
    url: z.string().optional(),
  })
  .passthrough();

const attachmentSchema = z
  .object({
    type: z.string(),
    payload: attachmentPayloadSchema.optional(),
  })
  .passthrough();

const messageBodySchema = z
  .object({
    mid: z.string().min(1),
    text: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
  })
  .passthrough();

const deliverySchema = z
  .object({
    mids: z.array(z.string().min(1)).default([]),
    watermark: z.number().optional(),
  })
  .passthrough();

const messagingItemSchema = z
  .object({
    sender: idHolderSchema.optional(),
    recipient: idHolderSchema.optional(),
    timestamp: z.number().optional(),
    message: messageBodySchema.optional(),
    delivery: deliverySchema.optional(),
    // read events ignored for v1 — watermark-based, would require bulk
    // update of OUTBOUND messages by createdAt; deferred to Phase 7.5.
    read: z.unknown().optional(),
    // postbacks, optins, account linking, message_reactions, message_edits
    // ignored for v1 — captured in the unhandled list inside aiMetadata if
    // we need forensics later (not in 7b scope).
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.string().min(1),
    time: z.number().optional(),
    messaging: z.array(messagingItemSchema).optional(),
    changes: z.unknown().optional(), // IG comments / media / etc — ignored in 7b
  })
  .passthrough();

const webhookEnvelopeSchema = z
  .object({
    object: z.enum(["page", "instagram"]),
    entry: z.array(entrySchema),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Parse + project
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDERS: Record<string, string> = {
  image: "[image]",
  audio: "[voice message]",
  video: "[video]",
  file: "[file]",
};

const ATTACHMENT_TO_CONTENT_TYPE: Record<string, MessageContentType> = {
  image: "IMAGE",
  audio: "VOICE",
  video: "FILE", // we don't have a VIDEO contentType in the enum
  file: "FILE",
};

export function parseMetaWebhook(rawJson: unknown): ParsedMetaWebhook {
  const env = webhookEnvelopeSchema.parse(rawJson);
  const channelKind: MetaChannelKind =
    env.object === "page" ? "messenger" : "instagram";

  const inbound: ParsedMetaInbound[] = [];
  const statuses: ParsedMetaDeliveryStatus[] = [];

  for (const entry of env.entry) {
    const externalAccountId = entry.id;
    for (const m of entry.messaging ?? []) {
      const ts = typeof m.timestamp === "number" ? m.timestamp : Date.now();

      if (m.message) {
        const customerExternalId = m.sender?.id;
        if (!customerExternalId) continue;
        const projected = projectMessage({
          message: m.message,
          channelKind,
          externalAccountId,
          customerExternalId,
          ts,
        });
        if (projected) inbound.push(projected);
      }

      if (m.delivery && m.delivery.mids.length > 0) {
        for (const mid of m.delivery.mids) {
          statuses.push({
            channelKind,
            externalAccountId,
            providerMessageId: mid,
            status: "delivered",
            timestamp: ts,
          });
        }
      }
    }
  }

  return { inbound, statuses };
}

function projectMessage(args: {
  message: z.infer<typeof messageBodySchema>;
  channelKind: MetaChannelKind;
  externalAccountId: string;
  customerExternalId: string;
  ts: number;
}): ParsedMetaInbound | null {
  const {
    message,
    channelKind,
    externalAccountId,
    customerExternalId,
    ts,
  } = args;

  // Text body wins if present.
  if (typeof message.text === "string" && message.text.length > 0) {
    return {
      channelKind,
      externalAccountId,
      customerExternalId,
      providerMessageId: message.mid,
      content: message.text,
      contentType: "TEXT",
      mediaUrl: null,
      timestamp: ts,
    };
  }

  // Attachments — first one only in v1.
  const att = message.attachments?.[0];
  if (att) {
    const type = att.type;
    const url = att.payload?.url ?? null;
    const contentType = ATTACHMENT_TO_CONTENT_TYPE[type] ?? "TEXT";
    const placeholder = PLACEHOLDERS[type] ?? `[${type}]`;
    return {
      channelKind,
      externalAccountId,
      customerExternalId,
      providerMessageId: message.mid,
      content: placeholder,
      contentType,
      mediaUrl: url,
      timestamp: ts,
    };
  }

  // No body, no attachments — likely a postback / story_mention / etc.
  // Skip silently; Phase 7 v1 doesn't model those.
  return null;
}
