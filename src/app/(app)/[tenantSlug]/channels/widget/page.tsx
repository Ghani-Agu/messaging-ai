import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTenantContext, ROLE_RANK } from "@/server/tenancy/context";
import { getWidgetChannel } from "@/server/db/channels";
import { parseWidgetChannelConfig } from "@/lib/validators";
import { WidgetConfigCard } from "@/components/app/channels/widget-config-card";
import { EnableWidgetForm } from "@/components/app/channels/enable-widget-form";

export const metadata: Metadata = {
  title: "Website widget",
};

export default async function WidgetChannelPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const widget = await getWidgetChannel(ctx.tenant.id);

  // Page-level role derivations. The same booleans get re-checked
  // server-side inside each action via requireTenantContext({ minRole }) —
  // these are UX-only. Defense in depth: page disables, action enforces.
  const role = ctx.membership.role;
  const canEnable = ROLE_RANK[role] >= ROLE_RANK["AGENT"];
  const canEditConfig = ROLE_RANK[role] >= ROLE_RANK["AGENT"];
  const canRotateKey = ROLE_RANK[role] >= ROLE_RANK["ADMIN"];

  // App URL for the embed snippet. Throw at render time rather than ship a
  // broken snippet — this is a deployment-config error, not a user error.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — embed snippet cannot be rendered.",
    );
  }

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
        <h1 className="text-h1 text-[var(--text-primary)]">Website widget</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          The widget runs on every page where the embed snippet is loaded.
          Origins below are checked on each request — empty allowlist means
          any site can embed (v1 default).
        </p>
      </header>

      {widget ? (
        (() => {
          const cfg = parseWidgetChannelConfig(widget.config);
          return (
            <WidgetConfigCard
              tenantSlug={tenantSlug}
              publicKey={cfg.publicKey}
              displayName={cfg.displayName ?? widget.displayName}
              themeAccent={cfg.themeAccent}
              originsAllowlist={cfg.originsAllowlist}
              status={widget.status}
              canEditConfig={canEditConfig}
              canRotateKey={canRotateKey}
              appUrl={appUrl}
            />
          );
        })()
      ) : (
        <EnableWidgetForm tenantSlug={tenantSlug} canEnable={canEnable} />
      )}
    </div>
  );
}
