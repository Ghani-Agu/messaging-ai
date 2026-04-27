import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import { PlaceholderPage } from "@/components/app/placeholder-page";

export const metadata: Metadata = {
  title: "Playground",
};

export default async function PlaygroundPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await getTenantContext(tenantSlug);
  return (
    <PlaceholderPage
      icon={Sparkles}
      title="Playground"
      description="Chat with your AI in Arabic, French, English, or Darija. Streams responses, shows which knowledge chunks were used, and exposes the confidence score."
      phaseNote="Phase 4"
    />
  );
}
