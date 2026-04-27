import type { Metadata } from "next";
import { Plug } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import { PlaceholderPage } from "@/components/app/placeholder-page";

export const metadata: Metadata = {
  title: "Channels",
};

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await getTenantContext(tenantSlug);
  return (
    <PlaceholderPage
      icon={Plug}
      title="Channels"
      description="Connect WhatsApp via 360dialog, Instagram via Meta Graph, or drop the website widget on your site. The widget ships in Phase 5."
      phaseNote="Phase 5–7"
    />
  );
}
