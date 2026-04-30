import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { getOperationalFacts } from "@/server/db/operational-facts";
import { BusinessInfoClient } from "@/components/app/operational-facts/business-info-client";

export const metadata: Metadata = {
  title: "Business Info",
};

export default async function BusinessInfoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // getTenantContext redirects to /login or notFound()s on miss — never null.
  const ctx = await getTenantContext(tenantSlug);
  const data = await getOperationalFacts({ tenantId: ctx.tenant.id });
  // VIEWERs see read-only inputs; AGENT and above can save. The actual
  // server-side AGENT-floor check lives at saveOperationalFacts.
  const canEdit = ctx.membership.role !== "VIEWER";

  return (
    <BusinessInfoClient
      tenantSlug={tenantSlug}
      initialData={data}
      canEdit={canEdit}
    />
  );
}
