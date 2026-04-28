import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/server/tenancy/context";
import { getConversationWithMessages } from "@/server/db/conversations";
import { ConversationDetailClient } from "@/components/app/conversations/conversation-detail-client";

export const metadata: Metadata = {
  title: "Conversation",
};

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; conversationId: string }>;
}) {
  const { tenantSlug, conversationId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const conversation = await getConversationWithMessages({
    tenantId: ctx.tenant.id,
    conversationId,
  });
  if (!conversation) notFound();
  return (
    <ConversationDetailClient
      slug={tenantSlug}
      initialConversation={conversation}
    />
  );
}
