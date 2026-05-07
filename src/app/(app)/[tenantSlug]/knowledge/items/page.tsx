import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  listAndCountItemsForTenant,
  listDistinctCategoriesForTenant,
} from "@/server/db/items";
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
  searchParams: Promise<{ page?: string; q?: string; category?: string }>;
}) {
  const { tenantSlug } = await params;
  const { page: rawPage, q: rawQ, category: rawCategory } = await searchParams;
  const ctx = await getTenantContext(tenantSlug);

  // Normalise filters: trim, then drop empty so downstream `if (search)` /
  // `if (category)` checks work uniformly.
  const search = rawQ?.trim() ? rawQ.trim() : undefined;
  const category = rawCategory?.trim() ? rawCategory.trim() : undefined;

  // First fetch with skip = (requested-1) * PAGE_SIZE. If the URL points
  // past the filtered total (e.g. operator was on page 5, then narrowed
  // the search to 12 results), clamp + re-fetch the right page. The
  // re-fetch path only triggers on out-of-range URLs; the common case is
  // one fetch.
  const requested = parsePageParam(rawPage);
  const [allCategories, firstPage] = await Promise.all([
    listDistinctCategoriesForTenant(ctx.tenant.id),
    listAndCountItemsForTenant({
      tenantId: ctx.tenant.id,
      search,
      category,
      skip: (requested - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  let { items, count } = firstPage;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = clampPage(requested, totalPages);
  if (page !== requested && count > 0) {
    const reslice = await listAndCountItemsForTenant({
      tenantId: ctx.tenant.id,
      search,
      category,
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
      search={search ?? ""}
      category={category ?? ""}
      allCategories={allCategories}
      canEdit={canEdit}
    />
  );
}
