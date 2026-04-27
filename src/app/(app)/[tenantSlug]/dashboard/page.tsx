import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-14">
      <h1 className="text-h1 text-[var(--text-primary)]">
        Welcome, {ctx.user.name ?? "there"}.
      </h1>
      <p className="mt-2 text-body text-[var(--text-secondary)]">
        Workspace: <span className="text-[var(--text-primary)]">{ctx.tenant.name}</span>
      </p>
      <p className="mt-6 text-body text-[var(--text-tertiary)]">
        (Real dashboard content arrives in the next commit.)
      </p>
    </div>
  );
}
