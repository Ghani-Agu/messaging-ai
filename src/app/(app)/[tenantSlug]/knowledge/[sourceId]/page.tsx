import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/server/tenancy/context";
import {
  countChunksForSource,
  getSource,
  listChunksForSource,
} from "@/server/db/knowledge";

const CHUNK_PREVIEW_LIMIT = 100;
import { SourceDetailClient } from "@/components/app/knowledge/source-detail-client";

export const metadata: Metadata = {
  title: "Source",
};

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; sourceId: string }>;
}) {
  const { tenantSlug, sourceId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const source = await getSource({ tenantId: ctx.tenant.id, sourceId });
  if (!source) notFound();
  const [chunks, totalChunks] = await Promise.all([
    listChunksForSource({
      tenantId: ctx.tenant.id,
      sourceId,
      limit: CHUNK_PREVIEW_LIMIT,
    }),
    countChunksForSource({ tenantId: ctx.tenant.id, sourceId }),
  ]);
  return (
    <SourceDetailClient
      slug={tenantSlug}
      source={source}
      chunks={chunks}
      totalChunks={totalChunks}
    />
  );
}
