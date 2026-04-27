import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { requireTenantContext } from "@/server/tenancy/context";
import { PlaceholderPage } from "@/components/app/placeholder-page";

export const metadata: Metadata = {
  title: "Billing",
};

export default async function BillingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Billing is OWNER-only — admins/agents/viewers shouldn't see invoices.
  await requireTenantContext(tenantSlug, { minRole: "OWNER" });
  return (
    <PlaceholderPage
      icon={CreditCard}
      title="Billing"
      description="Plans, usage, invoices, and the Stripe billing portal. Three tiers (Starter / Pro / Business) with usage metering and limit enforcement."
      phaseNote="Phase 9"
    />
  );
}
