import type { ReactNode } from "react";
import { getTenantContext } from "@/server/tenancy/context";
import { SettingsTabs } from "@/components/app/settings-tabs";

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
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-6">
        <h1 className="text-h1 text-[var(--text-primary)]">Settings</h1>
      </header>
      <SettingsTabs tenantSlug={tenantSlug} />
      <div className="pt-8">{children}</div>
    </div>
  );
}
