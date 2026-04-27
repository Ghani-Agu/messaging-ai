import Link from "next/link";
import { SidebarNav } from "./sidebar-nav";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserMenu } from "./user-menu";
import { CommandPaletteTrigger } from "./command-palette-trigger";

type SidebarProps = {
  tenant: { id: string; slug: string; name: string };
  memberships: Array<{
    tenantId: string;
    tenant: { id: string; slug: string; name: string };
  }>;
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
    isSuperAdmin: boolean;
  };
};

export function Sidebar({ tenant, memberships, user }: SidebarProps) {
  return (
    <aside
      aria-label="Primary navigation"
      className="flex h-screen w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <div className="px-3 pt-3">
        <Link
          href={`/${tenant.slug}/dashboard`}
          className="mb-2 block px-2 py-1 text-caption uppercase tracking-wider text-[var(--text-tertiary)]"
        >
          messaging-ai
        </Link>
        <WorkspaceSwitcher current={tenant} memberships={memberships} />
      </div>

      <SidebarNav tenantSlug={tenant.slug} />

      <div className="space-y-2 border-t border-[var(--border-subtle)] p-3">
        <CommandPaletteTrigger />
        <UserMenu user={user} />
      </div>
    </aside>
  );
}
