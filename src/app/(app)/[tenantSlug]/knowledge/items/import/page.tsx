import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { ItemsImportClient } from "@/components/app/items/items-import-client";

export const metadata: Metadata = {
  title: "Import products",
};

export default async function ItemsImportPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  // AGENT-floor enforced server-side at the action layer; gate the page
  // entrance too so VIEWERs don't see the import surface at all.
  const canImport = ctx.membership.role !== "VIEWER";
  return <ItemsImportClient tenantSlug={tenantSlug} canImport={canImport} />;
}
