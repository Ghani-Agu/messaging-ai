import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  countItemsForTenant,
  listItemsForTenant,
} from "@/server/db/items";
import { ItemsListClient } from "@/components/app/items/items-list-client";

export const metadata: Metadata = {
  title: "Products",
};

export default async function ItemsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [items, count] = await Promise.all([
    listItemsForTenant({ tenantId: ctx.tenant.id }),
    countItemsForTenant(ctx.tenant.id),
  ]);
  // VIEWERs see read-only inputs; AGENT and above can edit. Server-side
  // AGENT-floor enforcement lives at the create/update/delete actions.
  const canEdit = ctx.membership.role !== "VIEWER";

  return (
    <ItemsListClient
      tenantSlug={tenantSlug}
      initialItems={items}
      initialCount={count}
      canEdit={canEdit}
    />
  );
}
