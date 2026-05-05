"use client";

import { MessageSquare, Bot, Clock, Sparkles } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { useCountUp } from "@/hooks/use-count-up";
import type { DashboardMetrics } from "@/lib/dashboard-activity";

/**
 * Headline KPI strip on the active dashboard. Four tiles, first one
 * uses the `active` variant (per-tenant accent border + glow). All four
 * values count up via the useCountUp hook on first mount; reduced-motion
 * users see the final value immediately.
 */
export function KpiRow({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <ConversationsKpi
        thisWeek={metrics.conversationsThisWeek}
        lastWeek={metrics.conversationsLastWeek}
      />
      <RepliesKpi count={metrics.aiRepliesThisWeek} />
      <ResponseTimeKpi seconds={metrics.avgResponseTimeSeconds} />
      <ConfidenceKpi percent={metrics.aiConfidenceAverage} />
    </div>
  );
}

function ConversationsKpi({
  thisWeek,
  lastWeek,
}: {
  thisWeek: number;
  lastWeek: number;
}) {
  const animated = useCountUp(thisWeek);
  const delta = thisWeek - lastWeek;
  const footer = formatDeltaFooter(delta, "vs. last week");
  return (
    <KpiCard
      variant="active"
      label="Conversations"
      value={animated.toLocaleString()}
      icon={MessageSquare}
      footer={footer}
    />
  );
}

function RepliesKpi({ count }: { count: number }) {
  const animated = useCountUp(count);
  return (
    <KpiCard
      label="AI replies sent"
      value={animated.toLocaleString()}
      icon={Bot}
      footer="Last 7 days"
    />
  );
}

function ResponseTimeKpi({ seconds }: { seconds: number }) {
  const animated = useCountUp(seconds);
  return (
    <KpiCard
      label="Avg. response time"
      value={formatSeconds(animated)}
      icon={Clock}
      footer={seconds === 0 ? "No replies yet" : "Customer → AI median"}
    />
  );
}

function ConfidenceKpi({ percent }: { percent: number }) {
  const animated = useCountUp(percent);
  return (
    <KpiCard
      label="AI confidence"
      value={`${animated}%`}
      icon={Sparkles}
      footer={percent === 0 ? "No signal yet" : "Average across replies"}
    />
  );
}

function formatDeltaFooter(delta: number, suffix: string): string {
  if (delta === 0) return `Flat ${suffix}`;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ${suffix}`;
}

function formatSeconds(seconds: number): string {
  if (seconds === 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
