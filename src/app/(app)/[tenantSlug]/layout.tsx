import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { auth } from "@/server/auth";
import { getRoutingUser } from "@/server/db/tenancy";
import { getTenantContext } from "@/server/tenancy/context";
import { getTenantBrand } from "@/lib/tenant-brands";
import { Sidebar } from "@/components/app/sidebar";
import { CommandPalette } from "@/components/app/command-palette";
import { TenantThemeProvider } from "@/components/app/tenant-theme";
import { AmbientBackdrop } from "@/components/app/ambient-backdrop";

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
  const brand = getTenantBrand(ctx.tenant.slug);

  return (
    <TenantThemeProvider
      slug={ctx.tenant.slug}
      accentColor={ctx.tenant.accentColor}
    >
      <AmbientBackdrop tenantTinted />
      {/*
        Two-pane CSS-grid shell: aside auto-sizes to the Sidebar's
        Framer-animated width, main fills the rest. `h-screen` constrains
        both columns so main scrolls independently while the aside stays
        pinned. At sm the aside is hidden and the grid collapses to a
        single column; a placeholder hamburger lives in the mobile top
        bar inside main (TODO phase 11-9).
      */}
      <div className="relative grid h-screen grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)]">
        <Sidebar
          tenant={ctx.tenant}
          memberships={memberships}
          user={{
            name: ctx.user.name,
            email: ctx.user.email,
            image: ctx.user.image,
            isSuperAdmin: ctx.user.isSuperAdmin,
          }}
          hasBrandLogo={brand.hasLogo}
        />
        <main className="custom-scrollbar overflow-y-auto">
          <MobileTopBar tenantName={ctx.tenant.name} />
          {children}
        </main>
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

/**
 * Sm-only top bar with a hamburger placeholder. Non-functional in this
 * commit — the actual drawer ships in phase 11-9. Sticky inside main so
 * it stays visible while content scrolls. Hidden at md+ where the sidebar
 * is visible.
 */
function MobileTopBar({ tenantName }: { tenantName: string }) {
  return (
    <div
      className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/85 px-4 backdrop-blur-md md:hidden"
    >
      {/* TODO: phase 11-9 — wire the mobile drawer. */}
      <button
        type="button"
        aria-label="Open menu"
        disabled
        className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
      >
        <Menu className="size-4" aria-hidden />
      </button>
      <span className="truncate text-body-sm font-medium text-[var(--text-primary)]">
        {tenantName}
      </span>
    </div>
  );
}
