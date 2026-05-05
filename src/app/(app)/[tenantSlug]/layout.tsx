import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/server/auth";
import { getRoutingUser } from "@/server/db/tenancy";
import { getTenantContext } from "@/server/tenancy/context";
import { Sidebar } from "@/components/app/sidebar";
import { CommandPalette } from "@/components/app/command-palette";
import { TenantThemeProvider } from "@/components/app/tenant-theme";

type LayoutParams = { tenantSlug: string };

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
  const { tenantSlug } = await params;

  // Resolve tenant context (auth + membership). This is the single
  // chokepoint for "is this user allowed in this workspace?". Any failure
  // redirects or 404s before we render anything.
  const ctx = await getTenantContext(tenantSlug);

  // Fetch all memberships for the workspace switcher. getRoutingUser is
  // already cached per-request and was likely populated by /post-auth, but
  // re-call is cheap and keeps this layout self-sufficient when the user
  // navigates here directly.
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const routing = await getRoutingUser(session.user.id);
  const memberships = routing?.memberships ?? [];

  return (
    <TenantThemeProvider
      slug={ctx.tenant.slug}
      accentColor={ctx.tenant.accentColor}
    >
      <div className="flex min-h-screen">
        <Sidebar
          tenant={ctx.tenant}
          memberships={memberships}
          user={{
            name: ctx.user.name,
            email: ctx.user.email,
            image: ctx.user.image,
            isSuperAdmin: ctx.user.isSuperAdmin,
          }}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <CommandPalette
          tenantSlug={ctx.tenant.slug}
          currentTenantId={ctx.tenant.id}
          memberships={memberships}
          user={{ isSuperAdmin: ctx.user.isSuperAdmin }}
        />
      </div>
    </TenantThemeProvider>
  );
}
