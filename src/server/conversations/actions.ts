"use server";

import type { ChannelType } from "@prisma/client";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  getConversationWithMessages,
  listConversationsForTenant,
  type ConversationListRow,
  type ConversationWithMessages,
} from "@/server/db/conversations";

/**
 * Phase-6f read-only server actions for the conversations dashboard.
 * VIEWER role floor — anyone with workspace access can see threads.
 * Phase 8 adds takeover (pause AI, send manual reply) at AGENT+.
 */

export async function listConversations(
  slug: string,
  filters: { channelType?: ChannelType } = {},
): Promise<ConversationListRow[]> {
  const ctx = await requireTenantContext(slug, { minRole: "VIEWER" });
  return listConversationsForTenant({
    tenantId: ctx.tenant.id,
    channelType: filters.channelType,
  });
}

export async function getConversationDetail(
  slug: string,
  conversationId: string,
): Promise<ConversationWithMessages | null> {
  const ctx = await requireTenantContext(slug, { minRole: "VIEWER" });
  return getConversationWithMessages({
    tenantId: ctx.tenant.id,
    conversationId,
  });
}
