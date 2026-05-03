import "server-only";
import {
  Prisma,
  type ChannelType,
  type Conversation,
  type ConversationStatus,
  type Customer,
  type Message,
  type MessageContentType,
} from "@prisma/client";
import { prisma } from "./client";
import { CONVERSATION_RESUME_MAX_AGE_MS } from "@/server/channels/widget/limits";
import type { EscalationReason } from "@/server/ai/confidence";
import type { SupportedReplyLanguage } from "@/server/ai/claude-client";
import type { BrainCitation } from "@/server/ai/orchestrator";
import type { HistoryTurn } from "@/server/ai/prompts/system";

/**
 * Phase-6 Conversation / Customer / Message DB helper layer. All app code
 * reaches these tables through this module — never raw prisma.* in routes
 * or pages, per CLAUDE.md §3.
 *
 * The streaming widget route's flow is:
 *   1. recordInboundMessage(...) — persist customer turn first, get its id
 *   2. loadHistoryTurns({ excludeMessageId: <inbound.id>, limit: 8 })
 *   3. runBrainStream({ message: inbound.content, history: prior })
 *   4. recordAiMessage(...) on done
 *   5. if aiMetadata.escalation != null → markConversationForHandoff(...)
 *
 * Keeping recordAiMessage and markConversationForHandoff separate gives
 * Phase 8 a clean seam to plug in the Escalation row + agent notification.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Typed JSON shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persisted shape for Message.aiMetadata (AI rows only). Matches the
 * orchestrator's BrainResult, minus the reply text (which lives in
 * Message.content). The dashboard detail view reads this verbatim.
 *
 * Phase 6 additions (set by the outbound-dispatch hook after
 * recordAiMessage commits + by inbound delivery-status webhooks):
 *   - deliveryStatus / deliveryStatusAt — provider lifecycle. The
 *     dashboard renders an indicator on the bubble.
 *   - outboundSendError — present iff deliveryStatus = "failed";
 *     surfaced to the operator in the dashboard.
 */
export type MessageDeliveryStatus =
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped_outside_window"
  | "skipped_unsupported_channel";

export type MessageAiMetadata = {
  modelId: string;
  language: SupportedReplyLanguage;
  groundedness: number;
  confidence: number;
  escalation: EscalationReason | null;
  claudeRecommendedEscalation: boolean;
  claudeReason: EscalationReason | null;
  topChunkSimilarity: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  } | null;
  citations: BrainCitation[];
  citationsUsed: number[];
  deliveryStatus?: MessageDeliveryStatus;
  deliveryStatusAt?: string; // ISO
  outboundSendError?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Conversation lifecycle (widget ingress)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retry an operation that may fail with Prisma P2002 (unique constraint
 * violation) due to a race between two concurrent transactions both
 * inserting the same row. Up to MAX_ATTEMPTS attempts; on retry the
 * upsert path inside the operation will see the now-committed row and
 * update instead of insert.
 *
 * Why not just at-most-once: customer rows are upserted by
 * (tenantId, channelType, externalId) on every inbound widget message.
 * Two concurrent first-time messages from the same browser tab have a
 * narrow window where both transactions take the !exists branch of the
 * upsert and try to INSERT — one wins, the other gets P2002. A single
 * retry is always enough in practice; we allow three for safety.
 */
const P2002_MAX_ATTEMPTS = 3;
async function withP2002Retry<T>(op: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= P2002_MAX_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        lastErr = err;
        // Tiny stagger so the second attempt sees a committed winner.
        // 5ms × attempt is enough; not a concurrency-control mechanism,
        // just a polite yield to the event loop and the DB.
        await new Promise((r) => setTimeout(r, 5 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Find-or-create the active conversation for an incoming widget message.
 * Resume rule: the most recent ACTIVE conversation for (tenantId, customerId)
 * with lastMessageAt within CONVERSATION_RESUME_MAX_AGE_MS is reused;
 * otherwise a new Conversation row is created. Customer is upserted by
 * (tenantId, channelType, externalId). Both writes happen in one
 * transaction so a half-created customer can never be observed.
 *
 * The whole transaction is wrapped in withP2002Retry — if two concurrent
 * inbound messages from the same brand-new customer race the
 * customer.upsert insert, the second attempt sees the committed row and
 * goes down the update branch.
 */
export async function resolveOrCreateConversation(args: {
  tenantId: string;
  channelId: string;
  channelType: ChannelType;
  externalId: string;
  customerHints?: { name?: string; email?: string; phone?: string };
}): Promise<{
  conversation: Conversation;
  customer: Customer;
  resumed: boolean;
}> {
  const { tenantId, channelId, channelType, externalId, customerHints } = args;
  const now = new Date();
  const resumeFloor = new Date(now.getTime() - CONVERSATION_RESUME_MAX_AGE_MS);

  return withP2002Retry(() =>
    prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: {
          tenantId_channelType_externalId: { tenantId, channelType, externalId },
        },
        update: {
          lastSeenAt: now,
          ...(customerHints?.name ? { name: customerHints.name } : {}),
          ...(customerHints?.email ? { email: customerHints.email } : {}),
          ...(customerHints?.phone ? { phone: customerHints.phone } : {}),
        },
        create: {
          tenantId,
          channelType,
          externalId,
          name: customerHints?.name ?? null,
          email: customerHints?.email ?? null,
          phone: customerHints?.phone ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });

      const existing = await tx.conversation.findFirst({
        where: {
          tenantId,
          customerId: customer.id,
          status: "ACTIVE",
          lastMessageAt: { gte: resumeFloor },
        },
        orderBy: { lastMessageAt: "desc" },
      });
      if (existing) {
        return { conversation: existing, customer, resumed: true };
      }

      const created = await tx.conversation.create({
        data: {
          tenantId,
          customerId: customer.id,
          channelId,
          status: "ACTIVE",
          aiEnabled: true,
          lastMessageAt: now,
        },
      });
      return { conversation: created, customer, resumed: false };
    }),
  );
}

/** Tenant-scoped fetch; null if not in this tenant. */
export function getConversation(
  tenantId: string,
  conversationId: string,
): Promise<Conversation | null> {
  return prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });
}

/**
 * Find a Customer by the channel-specific identity tuple. Returns the
 * row if it exists for this tenant on this channel type, null otherwise.
 *
 * Used by the Meta webhook handler to decide whether to fire a
 * synchronous getProfile call on inbound: a customer that already
 * exists with a non-null `name` has already been resolved by a prior
 * webhook, so we skip the API call and reuse the cached label. This
 * keeps getProfile a one-shot per (tenant, externalId) lifetime rather
 * than per-message.
 *
 * Backed by the `tenantId_channelType_externalId` composite unique
 * (the same one used by the customer.upsert in
 * resolveOrCreateConversation), so the lookup is index-served.
 */
export function findCustomerByExternalId(args: {
  tenantId: string;
  channelType: ChannelType;
  externalId: string;
}): Promise<Customer | null> {
  return prisma.customer.findUnique({
    where: {
      tenantId_channelType_externalId: {
        tenantId: args.tenantId,
        channelType: args.channelType,
        externalId: args.externalId,
      },
    },
  });
}

export type ConversationWithMessages = Conversation & {
  channel: {
    id: string;
    type: ChannelType;
    displayName: string;
    /**
     * Channel.config JSON, included for the conversation detail header
     * to read channel-side identifiers — pageName for MESSENGER,
     * igUsername for INSTAGRAM. Read defensively in the display layer
     * (src/lib/conversation-display.ts) so a malformed row falls through
     * to the channel.displayName fallback.
     */
    config: Prisma.JsonValue;
  };
  customer: Customer;
  messages: Message[];
};

const CONVERSATION_MESSAGE_DEFAULT_LIMIT = 200;
const CONVERSATION_MESSAGE_MAX_LIMIT = 500;

/**
 * Conversation + last N messages oldest→newest, plus channel + customer
 * relations populated. The dashboard detail view (6f) reads exactly this.
 */
export async function getConversationWithMessages(args: {
  tenantId: string;
  conversationId: string;
  limit?: number;
}): Promise<ConversationWithMessages | null> {
  const limit = Math.min(
    args.limit ?? CONVERSATION_MESSAGE_DEFAULT_LIMIT,
    CONVERSATION_MESSAGE_MAX_LIMIT,
  );
  return prisma.conversation.findFirst({
    where: { id: args.conversationId, tenantId: args.tenantId },
    include: {
      channel: {
        select: { id: true, type: true, displayName: true, config: true },
      },
      customer: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: limit,
      },
    },
  });
}

export type ConversationListRow = Conversation & {
  channel: { id: string; type: ChannelType; displayName: string };
  customer: Pick<Customer, "id" | "name" | "email" | "phone" | "externalId">;
  _count: { messages: number };
  /**
   * Most-recent message preview, populated only when
   * listConversationsForTenant is called with `withLastMessage: true`.
   * Always 0 or 1 elements. Used by the dashboard list to render the
   * inbox-style preview line.
   */
  messages: Pick<Message, "id" | "direction" | "sender" | "content" | "createdAt">[];
};

const CONVERSATION_LIST_DEFAULT_LIMIT = 50;
const CONVERSATION_LIST_MAX_LIMIT = 200;

/**
 * Inbox query for the dashboard list. Filters by tenant, optionally by
 * channelType (joined via the channel relation — Prisma compiles
 * `channel: { type }` to a WHERE on the joined Channel.type column),
 * optionally by status. Ordered by lastMessageAt DESC; uses
 * Conversation_tenantId_lastMessageAt_idx as the covering index when no
 * channelType filter is set.
 *
 * Phase-7 follow-up: when multi-channel inboxes are real, denormalize
 * channelType onto Conversation so a (tenantId, channelType,
 * lastMessageAt DESC) index can serve filtered queries directly.
 */
export function listConversationsForTenant(args: {
  tenantId: string;
  channelType?: ChannelType;
  status?: ConversationStatus;
  limit?: number;
  cursor?: { lastMessageAt: Date; id: string };
}): Promise<ConversationListRow[]> {
  const take = Math.min(
    args.limit ?? CONVERSATION_LIST_DEFAULT_LIMIT,
    CONVERSATION_LIST_MAX_LIMIT,
  );
  return prisma.conversation.findMany({
    where: {
      tenantId: args.tenantId,
      ...(args.status ? { status: args.status } : {}),
      ...(args.channelType ? { channel: { type: args.channelType } } : {}),
      ...(args.cursor
        ? {
            OR: [
              { lastMessageAt: { lt: args.cursor.lastMessageAt } },
              {
                lastMessageAt: args.cursor.lastMessageAt,
                id: { lt: args.cursor.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take,
    include: {
      channel: { select: { id: true, type: true, displayName: true } },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          externalId: true,
        },
      },
      _count: { select: { messages: true } },
      // Most-recent message — 0 or 1 row per conversation. Drives the
      // dashboard inbox preview line. Marginal cost on the brain hot
      // path (which doesn't call this helper at all) and required for
      // the dashboard list, so always-on is the simplest tradeoff.
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          direction: true,
          sender: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Message writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a customer message. INBOUND + sender=CUSTOMER. In the same
 * transaction: conversation.lastMessageAt and customer.lastSeenAt are
 * bumped. Returns the new Message row so the route can flush it to the
 * SSE stream as the first frame.
 *
 * `providerMessageId` is the upstream message ID (e.g. WhatsApp wamid).
 * Persist it on inbound rows so webhook retries can be deduped on the
 * next call via findMessageByProviderId. Widget rows pass undefined.
 */
export async function recordInboundMessage(args: {
  tenantId: string;
  conversationId: string;
  customerId: string;
  content: string;
  contentType?: MessageContentType;
  mediaUrl?: string;
  providerMessageId?: string;
}): Promise<Message> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        direction: "INBOUND",
        sender: "CUSTOMER",
        content: args.content,
        contentType: args.contentType ?? "TEXT",
        mediaUrl: args.mediaUrl ?? null,
        providerMessageId: args.providerMessageId ?? null,
        createdAt: now,
      },
    });
    await tx.conversation.update({
      where: { id: args.conversationId },
      data: { lastMessageAt: now },
    });
    await tx.customer.update({
      where: { id: args.customerId },
      data: { lastSeenAt: now },
    });
    return message;
  });
}

/**
 * Webhook idempotency lookup. Returns the existing Message if this
 * provider message ID is already persisted for the tenant; null otherwise.
 * Backed by the Message_tenantId_providerMessageId_idx composite from
 * Phase 6a.
 */
export function findMessageByProviderId(args: {
  tenantId: string;
  providerMessageId: string;
}): Promise<Message | null> {
  return prisma.message.findFirst({
    where: {
      tenantId: args.tenantId,
      providerMessageId: args.providerMessageId,
    },
  });
}

/**
 * Atomic merge of one or more keys into Message.aiMetadata. COALESCE
 * handles the rare case where aiMetadata is NULL; the `||` jsonb
 * operator merges new keys over existing ones. Single UPDATE, no race
 * window vs concurrent writers (e.g. a webhook status update racing the
 * outbound-dispatch hook).
 *
 * Used both by the WhatsApp webhook handler (delivery-status updates
 * from the provider) and by the outbound-dispatch hook (post-commit
 * delivery-status from our own send result).
 *
 * Returns the number of rows affected; 0 means no matching row (likely
 * a webhook replay arriving for a long-pruned conversation, or an
 * unknown providerMessageId — the caller treats it as a soft miss).
 *
 * `byProviderMessageId` and `byMessageId` are the two lookup modes;
 * exactly one must be specified.
 */
export async function mergeMessageAiMetadata(args: {
  tenantId: string;
  byProviderMessageId?: string;
  byMessageId?: string;
  fields: Record<string, string>;
}): Promise<number> {
  if (Object.keys(args.fields).length === 0) return 0;
  const lookupByProvider = args.byProviderMessageId !== undefined;
  const lookupById = args.byMessageId !== undefined;
  if (lookupByProvider === lookupById) {
    throw new Error(
      "mergeMessageAiMetadata: specify exactly one of byProviderMessageId / byMessageId",
    );
  }

  // Build the SET clause's jsonb_build_object dynamically — keys are
  // hard-coded by the caller (not from user input), so string interp is
  // safe. Values are bound parameters.
  const keys = Object.keys(args.fields);
  const buildObjectArgs = keys
    .map((k, i) => `'${k}', $${i + 1}::text`)
    .join(", ");
  const tenantIdParamIndex = keys.length + 1;
  const lookupParamIndex = keys.length + 2;
  const lookupColumn = lookupByProvider
    ? `"providerMessageId"`
    : `"id"`;
  const lookupValue = lookupByProvider
    ? args.byProviderMessageId!
    : args.byMessageId!;

  const sql = `UPDATE "Message"
        SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || jsonb_build_object(${buildObjectArgs})
      WHERE "tenantId" = $${tenantIdParamIndex} AND ${lookupColumn} = $${lookupParamIndex}`;

  return prisma.$executeRawUnsafe(
    sql,
    ...keys.map((k) => args.fields[k]),
    args.tenantId,
    lookupValue,
  );
}

/**
 * Apply a delivery-status update from a provider webhook to an OUTBOUND
 * Message row. Wrapper over mergeMessageAiMetadata — the webhook only
 * needs to bump deliveryStatus + deliveryStatusAt.
 *
 * Status semantics (Meta/360dialog):
 *   sent      — accepted by provider
 *   delivered — handset acknowledged
 *   read      — customer opened (when read receipts are on)
 *   failed    — couldn't deliver (e.g. invalid number)
 */
export async function updateMessageDeliveryStatus(args: {
  tenantId: string;
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
}): Promise<number> {
  return mergeMessageAiMetadata({
    tenantId: args.tenantId,
    byProviderMessageId: args.providerMessageId,
    fields: {
      deliveryStatus: args.status,
      deliveryStatusAt: new Date().toISOString(),
    },
  });
}

/**
 * Most recent INBOUND message timestamp on a conversation. Used by the
 * outbound-dispatch hook to evaluate the WhatsApp 24h customer-service
 * window. Returns null when the conversation has no inbound messages
 * (the AI is never the conversation-starter in v1, so a null inbound
 * timestamp means the window is closed for outbound).
 */
export async function getLastInboundAt(args: {
  tenantId: string;
  conversationId: string;
}): Promise<Date | null> {
  const row = await prisma.message.findFirst({
    where: {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      direction: "INBOUND",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

/**
 * Stamp the providerMessageId on an existing OUTBOUND row after the
 * provider's sendMessage call returned successfully. Called by the
 * outbound-send hook (Phase 6d). Idempotent — if the row already has
 * a providerMessageId it's overwritten with the new value.
 */
export async function setMessageProviderId(args: {
  tenantId: string;
  messageId: string;
  providerMessageId: string;
}): Promise<void> {
  await prisma.message.updateMany({
    where: { id: args.messageId, tenantId: args.tenantId },
    data: { providerMessageId: args.providerMessageId },
  });
}

/**
 * Persist an AI reply. OUTBOUND + sender=AI. aiMetadata is the
 * BrainResult diagnostic envelope. In the same transaction:
 * conversation.lastMessageAt is bumped, conversation.language /
 * .sentiment patched if the brain reported a value.
 *
 * Phase 6d: AFTER the transaction commits, fires a channel-aware
 * post-commit side effect via dispatchOutboundReply. WIDGET is a
 * no-op (the streaming route already flushed the reply); WHATSAPP
 * checks the 24h window and calls the provider's sendMessage; future
 * channels plug in by adding a switch arm in outbound-dispatch.ts.
 *
 * The dispatch never throws — it stashes any failure into the message's
 * aiMetadata.deliveryStatus so the dashboard surfaces it. The brain's
 * persisted reply is never lost just because the provider call fell
 * over.
 *
 * Does NOT touch conversation.status or conversation.aiEnabled —
 * escalation handoff is a separate seam (markConversationForHandoff)
 * so Phase 8 can replace it with Escalation row + notifications
 * without touching this surface.
 */
export async function recordAiMessage(args: {
  tenantId: string;
  conversationId: string;
  content: string;
  aiMetadata: MessageAiMetadata;
}): Promise<Message> {
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        direction: "OUTBOUND",
        sender: "AI",
        content: args.content,
        contentType: "TEXT",
        aiMetadata: args.aiMetadata as unknown as Prisma.InputJsonValue,
        createdAt: now,
      },
    });
    await tx.conversation.update({
      where: { id: args.conversationId },
      data: {
        lastMessageAt: now,
        language: args.aiMetadata.language,
      },
    });
    return m;
  });

  // Post-commit channel-aware send. Imported lazily to avoid the
  // src/server/db/ → src/server/channels/ direction looking like a
  // hard dep cycle to the linter when channels reach back into db.
  const { dispatchOutboundReply } = await import(
    "@/server/channels/outbound-dispatch"
  );
  await dispatchOutboundReply({
    tenantId: args.tenantId,
    messageId: message.id,
    conversationId: args.conversationId,
    content: args.content,
  });

  return message;
}

/**
 * Mark a conversation as needing human handoff. Phase 6: flips status to
 * HUMAN_HANDLING and aiEnabled to false so the brain stops auto-replying.
 * Phase 8 will replace this with an Escalation row + agent notification;
 * keeping this as a separate helper preserves the seam.
 */
export async function markConversationForHandoff(args: {
  tenantId: string;
  conversationId: string;
  reason: EscalationReason;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: args.conversationId, tenantId: args.tenantId },
    data: {
      status: "HUMAN_HANDLING",
      aiEnabled: false,
      // Stash the reason in metadata until Phase 8 lands the Escalation row.
      metadata: { lastEscalationReason: args.reason },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator history input
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_TURNS_DEFAULT = 8;

/**
 * Last N messages oldest→newest in the orchestrator's HistoryTurn shape
 * (`role: "customer" | "you"` — see src/server/ai/prompts/system.ts).
 * Excludes the just-inserted INBOUND message — the route inserts that
 * message first, then calls this with the conversation's messages
 * EXCEPT the new one (filtered by id), so the orchestrator's
 * "history is everything BEFORE the new message" contract holds.
 */
export async function loadHistoryTurns(args: {
  tenantId: string;
  conversationId: string;
  excludeMessageId: string;
  limit?: number;
}): Promise<HistoryTurn[]> {
  const limit = args.limit ?? HISTORY_TURNS_DEFAULT;
  // Take the latest N before the excluded message, then reverse so the
  // orchestrator sees oldest→newest (HistoryTurn ordering contract).
  const rows = await prisma.message.findMany({
    where: {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      id: { not: args.excludeMessageId },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { sender: true, content: true },
  });
  return rows
    .reverse()
    .map<HistoryTurn>((m) => ({
      role: m.sender === "CUSTOMER" ? "customer" : "you",
      text: m.content,
    }));
}
