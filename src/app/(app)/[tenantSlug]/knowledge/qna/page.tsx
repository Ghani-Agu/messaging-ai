import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  countQnaPairsForTenant,
  listQnaPairsForTenant,
} from "@/server/db/qna";
import { QnaListClient } from "@/components/app/qna/qna-list-client";

export const metadata: Metadata = {
  title: "Q&A",
};

export default async function QnaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [pairs, count] = await Promise.all([
    listQnaPairsForTenant({ tenantId: ctx.tenant.id }),
    countQnaPairsForTenant(ctx.tenant.id),
  ]);
  // VIEWERs see read-only chrome; AGENT and above can edit. Server-side
  // AGENT-floor enforcement lives at the create/update/delete actions.
  const canEdit = ctx.membership.role !== "VIEWER";

  return (
    <QnaListClient
      tenantSlug={tenantSlug}
      initialPairs={pairs}
      initialCount={count}
      canEdit={canEdit}
    />
  );
}
