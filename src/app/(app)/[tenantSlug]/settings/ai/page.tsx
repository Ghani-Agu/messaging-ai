import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { AiBehaviorForm } from "@/components/app/ai-behavior-form";
import { getAiBehaviorForTenant } from "@/lib/validators";

export const metadata: Metadata = { title: "Settings · AI Behavior" };

export default async function AiBehaviorSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const canEdit = ctx.membership.role === "OWNER";
  const aiBehavior = getAiBehaviorForTenant(ctx.tenant.settings);

  return (
    <div className="space-y-10">
      <section aria-labelledby="ai-behavior-heading">
        <div className="mb-4">
          <h2
            id="ai-behavior-heading"
            className="text-h4 text-[var(--text-primary)]"
          >
            AI Behavior
          </h2>
          <p className="mt-1 max-w-2xl text-body-sm text-[var(--text-tertiary)]">
            Control how the AI replies to customers. Defaults match
            WhatsApp-first SMB best practices — minimal info sharing,
            escalate purchases to humans.
          </p>
        </div>
        <AiBehaviorForm
          tenantSlug={tenantSlug}
          initial={aiBehavior}
          canEdit={canEdit}
        />
      </section>
    </div>
  );
}
