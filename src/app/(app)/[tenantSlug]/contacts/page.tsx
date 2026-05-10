import type { Metadata } from "next";
import { requireTenantContext } from "@/server/tenancy/context";
import { listContactsForTenant } from "@/server/db/contacts";
import { ContactsListClient } from "@/components/app/contacts/contacts-list-client";

export const metadata: Metadata = {
  title: "Contacts",
};

export default async function ContactsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Read floor is VIEWER so non-owner team members can see what the AI
  // surfaces on escalation. Mutating actions enforce OWNER server-side.
  const ctx = await requireTenantContext(tenantSlug, { minRole: "VIEWER" });
  const contacts = await listContactsForTenant(ctx.tenant.id);
  const canEdit = ctx.membership.role === "OWNER";
  return (
    <ContactsListClient
      tenantSlug={tenantSlug}
      initialContacts={contacts}
      canEdit={canEdit}
    />
  );
}
