import "server-only";
import type { Channel } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  decryptCredentials,
  isEncryptedCredentials,
} from "@/server/channels/credentials";
import { getWhatsAppClient } from "./whatsapp/client";
import { getMessengerClient } from "./messenger/client";
import { getInstagramClient } from "./instagram/client";
import { readMetaCredentials } from "./meta/credentials";
import { isWithinCustomerServiceWindow } from "./policy";
import {
  whatsappCredentialsSchema,
  type WhatsAppCredentials,
} from "@/lib/validators";
import {
  getLastInboundAt,
  mergeMessageAiMetadata,
  setMessageProviderId,
  type MessageDeliveryStatus,
} from "@/server/db/conversations";

/**
 * Channel-aware post-commit side effect after recordAiMessage.
 *
 *   WIDGET    → no-op. The widget streaming response already flushed
 *               the reply to the customer's browser; nothing else to do.
 *   WHATSAPP  → 24h window check; if open, sendMessage via the
 *               channel's WhatsAppClient and stamp providerMessageId +
 *               deliveryStatus="sent". If closed, persist a
 *               deliveryStatus="skipped_outside_window" indicator so
 *               the dashboard shows the AI reply that wasn't sent.
 *               Phase 6.5 lights up template re-engagement on these.
 *   MESSENGER → 7d. Same shape as WHATSAPP — same 24h window via
 *               isWithinCustomerServiceWindow, same skipped/sent/failed
 *               states. Recipient is customer.externalId (PSID, no
 *               phone-number projection). Client comes from
 *               getMessengerClient (stub vs real handled by the factory
 *               via META_USE_STUB / META_APP_ID env).
 *   INSTAGRAM → 7d. Same as MESSENGER — same window, same states,
 *               recipient is customer.externalId (IGSID). Different
 *               client factory only.
 *
 * Never throws. The brain has done its work and the message row is
 * persisted; provider failures are operational, not data-integrity, and
 * get stashed into aiMetadata so the dashboard can render them.
 */

type DispatchArgs = {
  tenantId: string;
  messageId: string;
  conversationId: string;
  content: string;
};

export async function dispatchOutboundReply(
  args: DispatchArgs,
): Promise<void> {
  try {
    const convo = await prisma.conversation.findFirst({
      where: { id: args.conversationId, tenantId: args.tenantId },
      include: {
        channel: true,
        customer: true,
      },
    });
    if (!convo) {
      console.error(
        `outbound-dispatch: conversation ${args.conversationId} not found`,
      );
      return;
    }

    switch (convo.channel.type) {
      case "WIDGET":
        return;
      case "WHATSAPP":
        await dispatchWhatsApp({
          ...args,
          channel: convo.channel,
          customerPhone: convo.customer.phone ?? `+${convo.customer.externalId}`,
        });
        return;
      case "MESSENGER":
        await dispatchMessenger({
          ...args,
          channel: convo.channel,
          recipient: convo.customer.externalId,
        });
        return;
      case "INSTAGRAM":
        await dispatchInstagram({
          ...args,
          channel: convo.channel,
          recipient: convo.customer.externalId,
        });
        return;
    }
  } catch (err) {
    // Belt-and-suspenders — the inner functions catch their own errors,
    // but if anything unexpected escapes (e.g. the conversation lookup
    // throws), we don't want it bubbling out of recordAiMessage.
    console.error("outbound-dispatch: unexpected failure:", err);
    try {
      await stashDeliveryStatus({
        tenantId: args.tenantId,
        messageId: args.messageId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      /* ignore — best effort */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchWhatsApp(
  args: DispatchArgs & { channel: Channel; customerPhone: string },
): Promise<void> {
  // 1. Decrypt credentials.
  if (!isEncryptedCredentials(args.channel.credentials)) {
    console.error(
      `outbound-dispatch: WhatsApp channel ${args.channel.id} has unencrypted credentials`,
    );
    await stashDeliveryStatus({
      ...args,
      status: "failed",
      error: "credentials_missing",
    });
    return;
  }
  let credentials: WhatsAppCredentials;
  try {
    credentials = whatsappCredentialsSchema.parse(
      decryptCredentials(args.channel.credentials),
    );
  } catch (err) {
    console.error(
      `outbound-dispatch: decrypt failed for channel ${args.channel.id}:`,
      err,
    );
    await stashDeliveryStatus({
      ...args,
      status: "failed",
      error: "credentials_decrypt_failed",
    });
    return;
  }

  // 2. 24h customer-service window check. Computed-on-read — never
  //    cache "window open until X" on the conversation.
  const lastInboundAt = await getLastInboundAt({
    tenantId: args.tenantId,
    conversationId: args.conversationId,
  });
  if (!isWithinCustomerServiceWindow(lastInboundAt)) {
    console.warn(
      `outbound-dispatch: 24h window closed for conversation ${args.conversationId}; persisting "skipped_outside_window"`,
    );
    await stashDeliveryStatus({
      ...args,
      status: "skipped_outside_window",
    });
    return;
  }

  // 3. Send via the channel's client. Stub or real, depending on env
  //    toggles in getWhatsAppClient.
  const client = getWhatsAppClient({
    channel: args.channel,
    credentials,
  });
  let result: { providerMessageId: string };
  try {
    result = await client.sendMessage({
      to: args.customerPhone,
      content: args.content,
    });
  } catch (err) {
    console.error(
      `outbound-dispatch: WhatsApp sendMessage failed for ${args.messageId}:`,
      err,
    );
    await stashDeliveryStatus({
      ...args,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // 4. Stamp the providerMessageId so future status webhooks find this
  //    row. Done before the deliveryStatus merge so a fast-arriving
  //    delivery callback (the stub fires after 500ms; real providers
  //    can be slower but it's possible) finds the row by
  //    providerMessageId.
  await setMessageProviderId({
    tenantId: args.tenantId,
    messageId: args.messageId,
    providerMessageId: result.providerMessageId,
  });
  await stashDeliveryStatus({ ...args, status: "sent" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Messenger
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchMessenger(
  args: DispatchArgs & { channel: Channel; recipient: string },
): Promise<void> {
  const credentials = readMetaCredentials(args.channel);
  const client = getMessengerClient({
    channel: args.channel,
    credentials,
  });
  await dispatchMetaSend({ ...args, client });
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchInstagram(
  args: DispatchArgs & { channel: Channel; recipient: string },
): Promise<void> {
  const credentials = readMetaCredentials(args.channel);
  const client = getInstagramClient({
    channel: args.channel,
    credentials,
  });
  await dispatchMetaSend({ ...args, client });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Meta send path — window check, send, status stamp
// ─────────────────────────────────────────────────────────────────────────────
//
// Messenger and Instagram diverge only at credential decryption + client
// construction (different factories). Once we have a client + recipient,
// the rest is identical: 24h window check, sendMessage, providerMessageId
// stamp on success, status indicator either way. This helper is private
// to outbound-dispatch — the WhatsApp arm doesn't share it because its
// credential-error semantics differ (strict 500 + log on bad envelope vs.
// Meta's placeholder fallback).

interface MetaSendClient {
  sendMessage(args: {
    to: string;
    content: string;
  }): Promise<{ providerMessageId: string }>;
}

async function dispatchMetaSend(
  args: DispatchArgs & {
    channel: Channel;
    recipient: string;
    client: MetaSendClient;
  },
): Promise<void> {
  // 1. 24h customer-service window check. Computed-on-read — same policy
  //    as WhatsApp (CUSTOMER_SERVICE_WINDOW_MS in policy.ts is channel-
  //    agnostic since 7a). Outside the window: persist
  //    skipped_outside_window indicator and stop. The brain's reply is
  //    visible in the dashboard with the not-delivered badge.
  const lastInboundAt = await getLastInboundAt({
    tenantId: args.tenantId,
    conversationId: args.conversationId,
  });
  if (!isWithinCustomerServiceWindow(lastInboundAt)) {
    console.warn(
      `outbound-dispatch: 24h window closed for conversation ${args.conversationId}; persisting "skipped_outside_window"`,
    );
    await stashDeliveryStatus({
      ...args,
      status: "skipped_outside_window",
    });
    return;
  }

  // 2. Send. Stub or real, depending on env toggles in the leaf factory.
  let result: { providerMessageId: string };
  try {
    result = await args.client.sendMessage({
      to: args.recipient,
      content: args.content,
    });
  } catch (err) {
    console.error(
      `outbound-dispatch: Meta sendMessage failed for ${args.messageId}:`,
      err,
    );
    await stashDeliveryStatus({
      ...args,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // 3. Stamp providerMessageId before the status merge so a fast-arriving
  //    delivery webhook (the stub fires after 500ms) finds the row.
  await setMessageProviderId({
    tenantId: args.tenantId,
    messageId: args.messageId,
    providerMessageId: result.providerMessageId,
  });
  await stashDeliveryStatus({ ...args, status: "sent" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function stashDeliveryStatus(args: {
  tenantId: string;
  messageId: string;
  status: MessageDeliveryStatus;
  error?: string;
}): Promise<void> {
  const fields: Record<string, string> = {
    deliveryStatus: args.status,
    deliveryStatusAt: new Date().toISOString(),
  };
  if (args.error) {
    fields.outboundSendError = args.error;
  }
  await mergeMessageAiMetadata({
    tenantId: args.tenantId,
    byMessageId: args.messageId,
    fields,
  });
}
