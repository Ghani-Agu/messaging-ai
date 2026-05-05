import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROLE_RANK, getTenantContext } from "@/server/tenancy/context";
import { getWhatsAppChannel } from "@/server/db/channels";
import { parseWhatsAppChannelConfig } from "@/lib/validators";
import { WhatsAppConfigCard } from "@/components/app/channels/whatsapp-config-card";
import { WhatsAppConnectForm } from "@/components/app/channels/whatsapp-connect-form";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata: Metadata = {
  title: "WhatsApp",
};

export default async function WhatsAppChannelPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const channel = await getWhatsAppChannel(ctx.tenant.id);

  const role = ctx.membership.role;
  const canConnect = ROLE_RANK[role] >= ROLE_RANK["ADMIN"];
  const canEditConfig = ROLE_RANK[role] >= ROLE_RANK["AGENT"];
  const canRotateOrDisconnect = ROLE_RANK[role] >= ROLE_RANK["ADMIN"];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — webhook URL cannot be rendered.",
    );
  }
  const webhookUrl = `${appUrl.replace(/\/+$/, "")}/api/whatsapp/webhook`;
  const verifyToken = process.env.META_VERIFY_TOKEN ?? null;

  return (
    <PageShell width="3xl">
      <Link
        href={`/${tenantSlug}/channels`}
        className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text-tertiary)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="size-3.5" />
        Channels
      </Link>
      <div className="mt-3">
        <PageHeader
          eyebrow={<Eyebrow>Channel</Eyebrow>}
          title="WhatsApp"
          description="Two-way WhatsApp Business messaging via 360dialog. Inbound messages route through the same AI brain as the website widget; outbound replies respect Meta's 24-hour customer-service window — replies outside the window are persisted with a 'not delivered' indicator (templates land in Phase 6.5)."
        />
      </div>

      {channel ? (
        (() => {
          const cfg = parseWhatsAppChannelConfig(channel.config);
          return (
            <WhatsAppConfigCard
              tenantSlug={tenantSlug}
              status={channel.status}
              phoneNumberId={cfg.phoneNumberId}
              phoneNumber={cfg.phoneNumber}
              displayName={cfg.displayName ?? channel.displayName}
              webhookUrl={webhookUrl}
              verifyToken={verifyToken}
              canEditConfig={canEditConfig}
              canRotateOrDisconnect={canRotateOrDisconnect}
            />
          );
        })()
      ) : (
        <WhatsAppConnectForm tenantSlug={tenantSlug} canConnect={canConnect} />
      )}
    </PageShell>
  );
}
