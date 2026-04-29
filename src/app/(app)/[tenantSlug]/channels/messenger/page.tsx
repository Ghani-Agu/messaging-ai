import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROLE_RANK, getTenantContext } from "@/server/tenancy/context";
import { getMessengerChannel } from "@/server/db/channels";
import { parseMessengerChannelConfig } from "@/lib/validators";
import { MetaConfigCard } from "@/components/app/channels/meta-config-card";
import { MetaConnectForm } from "@/components/app/channels/meta-connect-form";

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
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-14">
      <Link
        href={`/${tenantSlug}/channels`}
        className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text-tertiary)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="size-3.5" />
        Channels
      </Link>
      <header className="mt-3 mb-8">
        <h1 className="text-h1 text-[var(--text-primary)]">Messenger</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          Two-way Facebook Messenger DMs via the Meta Graph API. The same
          Page Access Token authorizes Instagram on a linked Business
          account — connecting one Page can light up both surfaces.
          Outbound replies respect Meta&rsquo;s 24-hour customer-service
          window; messages outside the window persist with a &ldquo;not
          delivered&rdquo; indicator.
        </p>
      </header>

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
    </div>
  );
}
