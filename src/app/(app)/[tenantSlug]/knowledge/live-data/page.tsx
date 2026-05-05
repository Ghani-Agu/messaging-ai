import type { Metadata } from "next";
import { Database, Sparkles } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata: Metadata = {
  title: "Live Data Sources",
};

/**
 * Live Data Sources placeholder (Phase 8f).
 *
 * Type 4 of the five-types knowledge taxonomy (MASTER_PLAN). Pointers to
 * external systems (Odoo inventory, Google Calendar, e-commerce order
 * status) the AI should query for fresh data instead of stored snapshots.
 *
 * Deferred until the action framework lands. This placeholder reserves
 * the route + sidebar slot so operators have a stable mental model of
 * where the feature will live; the real implementation comes later.
 */
export default async function LiveDataPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Auth-gate the page even though it has no live functionality —
  // VIEWER+ can see the placeholder, anyone else hits the same notFound
  // / login-redirect that other (app) routes do.
  await getTenantContext(tenantSlug);

  return (
    <PageShell width="3xl" className="space-y-6">
      <PageHeader
        eyebrow={<Eyebrow>Knowledge</Eyebrow>}
        title="Live Data Sources"
        description="Connect external systems so your AI answers from live data instead of stored snapshots."
      />

      <div className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-lg border border-[var(--accent-base)]/30 bg-[var(--accent-glow)]/30 p-3 text-[var(--accent-hover)]">
            <Database className="size-6" aria-hidden />
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-h4 text-[var(--text-primary)]">Coming soon</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-base)]/40 bg-[var(--accent-glow)]/30 px-2 py-0.5 text-caption text-[var(--accent-hover)]">
                <Sparkles className="size-3" aria-hidden />
                in development
              </span>
            </div>
            <p className="text-body text-[var(--text-secondary)]">
              Connect external systems so the AI answers from live data instead
              of stored snapshots. Inventory from Odoo. Appointments from Google
              Calendar. Order status from your e-commerce platform.
            </p>
            <p className="text-body-sm text-[var(--text-tertiary)]">
              Currently in development — available in a future release.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-4 py-3 text-body-sm text-[var(--text-tertiary)]">
        For now, knowledge that changes frequently is best maintained as
        Products (with the &ldquo;Mark all as verified&rdquo; bulk action after price
        sweeps) or curated Q&amp;A pairs. Stored snapshots, refreshed on a
        schedule you control.
      </div>
    </PageShell>
  );
}
