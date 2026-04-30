import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  loadGapClusters,
  loadUnclusteredGaps,
} from "@/server/db/knowledge-gaps";
import { GapsListClient } from "@/components/app/gaps/gaps-list-client";

export const metadata: Metadata = {
  title: "Knowledge Gaps",
};

export default async function GapsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [clusters, unclustered] = await Promise.all([
    loadGapClusters({ tenantId: ctx.tenant.id }),
    loadUnclusteredGaps({ tenantId: ctx.tenant.id }),
  ]);
  const canResolve = ctx.membership.role !== "VIEWER";

  return (
    <GapsListClient
      tenantSlug={tenantSlug}
      initialClusters={clusters}
      initialUnclustered={unclustered}
      canResolve={canResolve}
    />
  );
}
