import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROLE_RANK, getTenantContext } from "@/server/tenancy/context";
import { getInstagramChannel } from "@/server/db/channels";
import { parseInstagramChannelConfig } from "@/lib/validators";
import { MetaConfigCard } from "@/components/app/channels/meta-config-card";
import { MetaConnectForm } from "@/components/app/channels/meta-connect-form";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata: Metadata = {
  title: "Instagram",
};

export default async function InstagramChannelPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const channel = await getInstagramChannel(ctx.tenant.id);

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
          title="Instagram"
          description="Reply to Instagram DMs from a connected Business account. IG Business accounts always ride a Facebook Page — connecting via the Page Access Token authorizes both Messenger and Instagram on that Page. The same 24-hour customer-service window applies."
        />
      </div>

      {channel ? (
        (() => {
          const cfg = parseInstagramChannelConfig(channel.config);
          const igDisplay = cfg.igUsername
            ? `@${cfg.igUsername}`
            : "(no @username on file)";
          return (
            <MetaConfigCard
              tenantSlug={tenantSlug}
              platform="instagram"
              status={channel.status}
              displayName={cfg.displayName ?? channel.displayName}
              readOnlyRows={[
                { label: "Instagram", value: igDisplay },
                { label: "IG user id", value: cfg.igUserId, mono: true },
                { label: "Linked Page id", value: cfg.pageId, mono: true },
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
          entryPlatform="instagram"
        />
      )}
    </PageShell>
  );
}
