import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROLE_RANK, getTenantContext } from "@/server/tenancy/context";
import { getWhatsAppChannel } from "@/server/db/channels";
import { parseWhatsAppChannelConfig } from "@/lib/validators";
import { WhatsAppConfigCard } from "@/components/app/channels/whatsapp-config-card";
import { WhatsAppConnectForm } from "@/components/app/channels/whatsapp-connect-form";

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
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-14">
      <Link
        href={`/${tenantSlug}/channels`}
        className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text-tertiary)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="size-3.5" />
        Channels
      </Link>
      <header className="mt-3 mb-8">
        <h1 className="text-h1 text-[var(--text-primary)]">WhatsApp</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          Two-way WhatsApp Business messaging via 360dialog. Inbound
          messages route through the same AI brain as the website widget;
          outbound replies respect Meta&rsquo;s 24-hour customer-service
          window — replies outside the window are persisted with a
          &ldquo;not delivered&rdquo; indicator (templates land in
          Phase 6.5).
        </p>
      </header>

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
    </div>
  );
}
