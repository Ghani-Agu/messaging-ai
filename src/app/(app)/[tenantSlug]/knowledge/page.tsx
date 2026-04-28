import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listSourcesForTenant } from "@/server/db/knowledge";
import { KnowledgeListClient } from "@/components/app/knowledge/knowledge-list-client";

export const metadata: Metadata = {
  title: "Knowledge",
};

export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const sources = await listSourcesForTenant(ctx.tenant.id);
  return <KnowledgeListClient slug={tenantSlug} initialSources={sources} />;
}
