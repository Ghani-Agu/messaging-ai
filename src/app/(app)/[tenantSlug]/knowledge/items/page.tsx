import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listAndCountItemsForTenant } from "@/server/db/items";
import { ItemsListClient } from "@/components/app/items/items-list-client";
import { clampPage, parsePageParam } from "@/lib/pagination";

export const metadata: Metadata = {
  title: "Products",
};

const PAGE_SIZE = 50;

export default async function ItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantSlug } = await params;
  const { page: rawPage } = await searchParams;
  const ctx = await getTenantContext(tenantSlug);

  // First fetch with skip=0 to learn the total, then re-fetch the right page
  // if the URL pointed past the end. The two-fetch path only triggers when
  // the operator typed an out-of-range page; the common case is one fetch.
  const requested = parsePageParam(rawPage);
  let { items, count } = await listAndCountItemsForTenant({
    tenantId: ctx.tenant.id,
    skip: (requested - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = clampPage(requested, totalPages);
  if (page !== requested && count > 0) {
    const reslice = await listAndCountItemsForTenant({
      tenantId: ctx.tenant.id,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    items = reslice.items;
    count = reslice.count;
  }
  // VIEWERs see read-only inputs; AGENT and above can edit. Server-side
  // AGENT-floor enforcement lives at the create/update/delete actions.
  const canEdit = ctx.membership.role !== "VIEWER";

  return (
    <ItemsListClient
      tenantSlug={tenantSlug}
      initialItems={items}
      initialCount={count}
      page={page}
      pageSize={PAGE_SIZE}
      totalPages={totalPages}
      canEdit={canEdit}
    />
  );
}
