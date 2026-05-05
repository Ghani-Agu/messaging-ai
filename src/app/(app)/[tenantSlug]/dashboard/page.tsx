import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  getDashboardMetrics,
  getRecentActivity,
} from "@/server/db/dashboard-metrics";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import { KpiRow } from "@/components/app/dashboard/kpi-row";
import { PerfChart } from "@/components/app/dashboard/perf-chart";
import { ActivityTimeline } from "@/components/app/dashboard/activity-timeline";
import { OnboardingStrip } from "@/components/app/dashboard/onboarding-strip";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const greeting = ctx.user.name ?? ctx.user.email?.split("@")[0] ?? "there";

  // Fetch metrics + activity in parallel. Both are scoped by tenantId
  // server-side; the dashboard's empty-state branch reads
  // metrics.hasAnyChannelConnected to decide which composition to render.
  const [metrics, activity] = await Promise.all([
    getDashboardMetrics(ctx.tenant.id),
    getRecentActivity(ctx.tenant.id),
  ]);

  return (
    <PageShell width="6xl">
      <PageHeader
        eyebrow={<Eyebrow>{ctx.tenant.name}</Eyebrow>}
        title={`Welcome, ${greeting}.`}
        description={
          metrics.hasAnyChannelConnected
            ? "Last 7 days of AI activity, customer conversations, and the work waiting on you."
            : "You're a few steps away from your AI replying to customers."
        }
      />

      {metrics.hasAnyChannelConnected ? (
        <ActiveDashboard
          tenantSlug={tenantSlug}
          metrics={metrics}
          activity={activity}
        />
      ) : (
        <OnboardingStrip tenantSlug={tenantSlug} />
      )}
    </PageShell>
  );
}

function ActiveDashboard({
  tenantSlug,
  metrics,
  activity,
}: {
  tenantSlug: string;
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>>;
  activity: Awaited<ReturnType<typeof getRecentActivity>>;
}) {
  return (
    <>
      <KpiRow metrics={metrics} />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PerfChart data={metrics.repliesPerDay} />
        </div>
        <div className="lg:col-span-1">
          <ActivityTimeline events={activity} />
        </div>
      </div>

      {/*
        OnboardingStrip stays available even on the active dashboard while
        any setup step is still relevant. Detection by-step is post-v1; for
        now we render the strip when any of the v1 success signals are
        weak (no AI replies yet, or escalation rate >= 50%, etc.). Phase D
        keeps the heuristic narrow: render only if no AI replies have
        landed yet.
      */}
      {metrics.aiRepliesThisWeek === 0 ? (
        <OnboardingStrip tenantSlug={tenantSlug} compact />
      ) : null}
    </>
  );
}
