import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import { PlaceholderPage } from "@/components/app/placeholder-page";

export const metadata: Metadata = {
  title: "Conversations",
};

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await getTenantContext(tenantSlug);
  return (
    <PlaceholderPage
      icon={MessageSquare}
      title="Conversations"
      description="Once you connect WhatsApp, Instagram, or the website widget, every customer thread will live here — sortable, filterable, and live."
      phaseNote="Phase 5"
    />
  );
}
