import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROLE_RANK, getTenantContext } from "@/server/tenancy/context";
import { getMessengerChannel } from "@/server/db/channels";
import { parseMessengerChannelConfig } from "@/lib/validators";
import { MetaConfigCard } from "@/components/app/channels/meta-config-card";
import { MetaConnectForm } from "@/components/app/channels/meta-connect-form";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata: Metadata = {
  title: "Messenger",
};

export default async function MessengerChannelPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const channel = await getMessengerChannel(ctx.tenant.id);

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
  const webhookUrl = `${appUrl.replace(/\/+$/, "")}/api/meta/webhook`;
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
          title="Messenger"
          description="Two-way Facebook Messenger DMs via the Meta Graph API. The same Page Access Token authorizes Instagram on a linked Business account — connecting one Page can light up both surfaces. Outbound replies respect Meta's 24-hour customer-service window; messages outside the window persist with a 'not delivered' indicator."
        />
      </div>

      {channel ? (
        (() => {
          const cfg = parseMessengerChannelConfig(channel.config);
          return (
            <MetaConfigCard
              tenantSlug={tenantSlug}
              platform="messenger"
              status={channel.status}
              displayName={cfg.displayName ?? channel.displayName}
              readOnlyRows={[
                { label: "Page name", value: cfg.pageName },
                { label: "Page id", value: cfg.pageId, mono: true },
              ]}
              webhookUrl={webhookUrl}
              verifyToken={verifyToken}
              canEditConfig={canEditConfig}
              canRotateOrDisconnect={canRotateOrDisconnect}
            />
          );
        })()
      ) : (
        <MetaConnectForm
          tenantSlug={tenantSlug}
          canConnect={canConnect}
          entryPlatform="messenger"
        />
      )}
    </PageShell>
  );
}
