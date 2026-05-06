import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { getTenantContext, ROLE_RANK } from "@/server/tenancy/context";
import { LiveDataListClient } from "@/components/app/live-data/live-data-list-client";

export const metadata: Metadata = {
  title: "Live Data Sources",
};

// Always render fresh — sync state changes through cron + Server Actions
// without going through router-cache invalidation in every code path.
export const dynamic = "force-dynamic";

/**
 * Live Data Sources page. Type 4 of the five-types knowledge taxonomy
 * (MASTER_PLAN). Today: Odoo polling. Future commits add Shopify /
 * WooCommerce / MANUAL_CSV / Google Sheets / WEBHOOK adapters via the
 * dispatch in src/server/integrations/dispatch.ts.
 *
 * Reads OWNER-vs-other once on the server so the client knows whether
 * to show write affordances. The Server Actions themselves re-check
 * OWNER independently — this is chrome, not security.
 */
export default async function LiveDataPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);

  const canEdit = ROLE_RANK[ctx.membership.role] >= ROLE_RANK.OWNER;

  const sources = await prisma.liveDataSource.findMany({
    where: { tenantId: ctx.tenant.id },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  return (
    <LiveDataListClient
      tenantSlug={ctx.tenant.slug}
      tenantName={ctx.tenant.name}
      sources={sources}
      canEdit={canEdit}
    />
  );
}
