import "server-only";
import type {
  ChannelType,
  Conversation,
  ConversationStatus,
  Customer,
  Message,
  MessageContentType,
  Prisma,
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
 */
export type MessageAiMetadata = {
  modelId: string;
  language: SupportedReplyLanguage;
  groundedness: number;
  confidence: number;
  escalation: EscalationReason | null;
  claudeRecommendedEscalation: boolean;
  claudeReason: EscalationReason | null;
  topChunkSimilarity: number;
  usage: { inputTokens: number; outputTokens: number } | null;
  citations: BrainCitation[];
  citationsUsed: number[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Conversation lifecycle (widget ingress)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find-or-create the active conversation for an incoming widget message.
 * Resume rule: the most recent ACTIVE conversation for (tenantId, customerId)
 * with lastMessageAt within CONVERSATION_RESUME_MAX_AGE_MS is reused;
 * otherwise a new Conversation row is created. Customer is upserted by
 * (tenantId, channelType, externalId). Both writes happen in one
 * transaction so a half-created customer can never be observed.
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

  return prisma.$transaction(async (tx) => {
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
  });
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

export type ConversationWithMessages = Conversation & {
  channel: { id: string; type: ChannelType; displayName: string };
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
      channel: { select: { id: true, type: true, displayName: true } },
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
 */
export async function recordInboundMessage(args: {
  tenantId: string;
  conversationId: string;
  customerId: string;
  content: string;
  contentType?: MessageContentType;
  mediaUrl?: string;
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
 * Persist an AI reply. OUTBOUND + sender=AI. aiMetadata is the
 * BrainResult diagnostic envelope. In the same transaction:
 * conversation.lastMessageAt is bumped, conversation.language /
 * .sentiment patched if the brain reported a value.
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
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
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
    return message;
  });
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
