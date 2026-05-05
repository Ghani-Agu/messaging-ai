import type { ReactNode } from "react";
import { getTenantContext } from "@/server/tenancy/context";
import { SettingsTabs } from "@/components/app/settings-tabs";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Auth + membership; throws to redirect/notFound on miss.
  await getTenantContext(tenantSlug);
  return (
    <PageShell width="4xl">
      <PageHeader eyebrow={<Eyebrow>Workspace</Eyebrow>} title="Settings" />
      <SettingsTabs tenantSlug={tenantSlug} />
      <div className="pt-8">{children}</div>
    </PageShell>
  );
}
