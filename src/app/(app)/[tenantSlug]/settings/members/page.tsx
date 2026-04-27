import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listTenantMembers } from "@/server/db/tenancy";
import { MembersList } from "@/components/app/members-list";

export const metadata: Metadata = { title: "Settings · Members" };

export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const members = await listTenantMembers(ctx.tenant.id);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-h4 text-[var(--text-primary)]">Members</h2>
          <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
            Everyone with access to {ctx.tenant.name}.
          </p>
        </div>
        <span className="text-body-sm text-[var(--text-tertiary)]">
          {members.length} {members.length === 1 ? "member" : "members"}
        </span>
      </header>

      <MembersList members={members} currentUserId={ctx.user.id} />

      <p className="text-body-sm text-[var(--text-tertiary)]">
        Inviting teammates and changing roles arrives in Phase 9 alongside
        billing — until then this is a read-only roster.
      </p>
    </div>
  );
}
