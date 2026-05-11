import "server-only";

import { prisma } from "@/server/db/client";
import {
  getEffectivePermissions,
  type PermissionSlug,
} from "@/lib/permissions";
import type { EscalationReason } from "@/server/ai/confidence";

/**
 * Trigger-site context for an AI-handoff notification. Required at every
 * call site — composition logic lives in composeHandoffSummary and reads
 * every field, so missing data would degrade the message body silently.
 *
 * `channel` is a wire-friendly lowercase tag (not the ChannelType enum)
 * because it appears in customer-facing strings. `customerIdentifier`
 * varies per channel — phone number for WhatsApp, PSID/IGSID for Meta,
 * widget visitor UUID for the widget — and is optional only when the
 * channel genuinely has no identifier to surface (currently never).
 */
export type HandoffNotificationContext = {
  customerMessage: string;
  customerIdentifier?: string;
  channel: "widget" | "whatsapp" | "messenger" | "instagram";
};

const CONVERSATIONS_VIEW: PermissionSlug = "conversations:view";

/**
 * Customer-message excerpt cap in the notification body. 140 chars keeps
 * the body within a couple of bell-tray lines and the email subject line
 * within ~one mobile preview width.
 */
const MESSAGE_EXCERPT_MAX_CHARS = 140;

/**
 * Compose the title + body for an AI-handoff notification.
 *
 * Lives alongside createHandoffNotifications so the in-app row and the
 * future email template share the same strings — no per-surface copy
 * drift when the email transport lands in a subsequent prompt.
 *
 * Title is fixed; body interpolates customer identifier (or "Customer"
 * fallback) + channel tag + truncated message + escalation reason.
 */
export function composeHandoffSummary(
  context: HandoffNotificationContext,
  reason: EscalationReason,
): { title: string; body: string } {
  const subject = context.customerIdentifier ?? "Customer";
  const message = context.customerMessage;
  const excerpt =
    message.length > MESSAGE_EXCERPT_MAX_CHARS
      ? `${message.slice(0, MESSAGE_EXCERPT_MAX_CHARS)}…`
      : message;
  return {
    title: "AI requested human handoff",
    body: `${subject} on ${context.channel}: "${excerpt}" (reason: ${reason})`,
  };
}

/**
 * Fan-out notification creation for an AI handoff event. Inserts one
 * Notification row per tenant member whose effective permissions include
 * `conversations:view`. OWNER short-circuits to the full slug list inside
 * getEffectivePermissions, so OWNERs are always eligible.
 *
 * Idempotency: repeated invocations for the same conversation create NEW
 * rows. Dedupe is intentionally absent for v1 per prompt 1 spec — if a
 * single conversation flags handoff multiple times, the operator sees
 * one notification per flag. Can revisit if it becomes noisy.
 *
 * Returns the count of notifications created (`createMany.count`); 0
 * when no eligible recipients exist (no crash).
 */
export async function createHandoffNotifications(args: {
  tenantId: string;
  conversationId: string;
  reason: EscalationReason;
  context: HandoffNotificationContext;
}): Promise<number> {
  const { tenantId, conversationId, reason, context } = args;

  const members = await prisma.tenantUser.findMany({
    where: { tenantId },
    select: { userId: true, role: true, permissions: true },
  });

  const recipients = members.filter((m) =>
    getEffectivePermissions({
      role: m.role,
      permissions: m.permissions,
    }).includes(CONVERSATIONS_VIEW),
  );
  if (recipients.length === 0) return 0;

  const { title, body } = composeHandoffSummary(context, reason);

  // Every row carries tenantId — required by the schema's tenant-scoping
  // rule (see Notification model comment) and matches the leading column
  // of the [tenantId, userId, *] indexes used by the bell-tray queries.
  const result = await prisma.notification.createMany({
    data: recipients.map((r) => ({
      tenantId,
      userId: r.userId,
      type: "AI_HANDOFF_REQUESTED" as const,
      conversationId,
      title,
      body,
    })),
  });
  return result.count;
}
