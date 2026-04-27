import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import { PlaceholderPage } from "@/components/app/placeholder-page";

export const metadata: Metadata = {
  title: "Knowledge",
};

export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await getTenantContext(tenantSlug);
  return (
    <PlaceholderPage
      icon={BookOpen}
      title="Knowledge"
      description="Teach your AI by pasting a website URL, uploading PDFs, or writing manual entries. Phase 3 wires Firecrawl, LlamaParse, and Voyage embeddings."
      phaseNote="Phase 3"
    />
  );
}
