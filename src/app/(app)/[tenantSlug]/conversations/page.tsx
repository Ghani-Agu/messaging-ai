import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listConversationsForTenant } from "@/server/db/conversations";
import { ConversationsListClient } from "@/components/app/conversations/conversations-list-client";

export const metadata: Metadata = {
  title: "Conversations",
};

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  // Default tab is WIDGET since that's the only live channel in v1.
  const initial = await listConversationsForTenant({
    tenantId: ctx.tenant.id,
    channelType: "WIDGET",
    limit: 50,
  });
  return (
    <ConversationsListClient slug={tenantSlug} initialConversations={initial} />
  );
}
