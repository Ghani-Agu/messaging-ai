import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listTenantMembers } from "@/server/db/tenancy";
import { listPendingInvitations } from "@/server/db/invitations";
import { MembersManager } from "@/components/app/members-manager";

export const metadata: Metadata = { title: "Settings · Members" };

export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);

  const [members, invitations] = await Promise.all([
    listTenantMembers(ctx.tenant.id),
    listPendingInvitations(ctx.tenant.id),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-h4 text-[var(--text-primary)]">Members</h2>
        <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
          Everyone with access to {ctx.tenant.name}.
        </p>
      </header>

      <MembersManager
        tenantSlug={tenantSlug}
        currentUserId={ctx.user.id}
        currentUserRole={ctx.membership.role}
        members={members.map((m) => ({
          id: m.id,
          userId: m.user.id,
          role: m.role,
          permissions: m.permissions,
          joinedAt: m.joinedAt.toISOString(),
          name: m.user.name,
          email: m.user.email,
          image: m.user.image,
        }))}
        invitations={invitations.map((inv) => ({
          id: inv.id,
          email: inv.email,
          name: inv.name,
          role: inv.role,
          permissions: inv.permissions,
          status: inv.status,
          createdAt: inv.createdAt.toISOString(),
          expiresAt: inv.expiresAt.toISOString(),
          inviterName: inv.inviter.name,
          inviterEmail: inv.inviter.email,
        }))}
      />
    </div>
  );
}
