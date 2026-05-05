import type { Metadata } from "next";
import { PlaygroundShell } from "@/components/app/playground/playground-shell";

export const metadata: Metadata = {
  title: "Playground",
};

export default async function PlaygroundPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <PlaygroundShell tenantSlug={tenantSlug} />;
}
