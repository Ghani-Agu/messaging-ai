"use client";

import { useReducedMotion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

interface PerfChartProps {
  data: Array<{ day: string; count: number }>;
}

const GRADIENT_ID = "perf-chart-fill";
const STROKE_WIDTH = 2.2;
const ANIMATION_DURATION = 1200;

/**
 * 7-day AI-replies-per-day line chart. Theme:
 *   - Stroke uses --accent-hover (per-tenant override picks this up
 *     automatically because the chart sits inside [data-tenant=…]).
 *   - Area fill is a gradient from the same accent at 0.32 alpha down
 *     to transparent.
 *   - Recharts native isAnimationActive draws in on mount; honors
 *     prefers-reduced-motion.
 *   - Custom tooltip uses the design-system Card chrome.
 */
export function PerfChart({ data }: PerfChartProps) {
  const prefersReducedMotion = useReducedMotion();
  const isAnimationActive = !prefersReducedMotion;

  return (
    <Card className="flex flex-col p-5">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Eyebrow>Performance</Eyebrow>
          <p className="mt-1 text-body-sm font-medium text-[var(--text-primary)]">
            AI replies — last 7 days
          </p>
        </div>
      </header>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--accent-base)"
                  stopOpacity={0.32}
                />
                <stop
                  offset="100%"
                  stopColor="var(--accent-base)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="var(--border-subtle)"
              strokeDasharray="3 4"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tickFormatter={(d: string) => formatTickDay(d)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--text-tertiary)", fontSize: 9 }}
              interval={0}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--text-tertiary)", fontSize: 9 }}
              width={28}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--border-default)", strokeDasharray: "2 4" }}
              content={<PerfTooltip />}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--accent-hover)"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              fill={`url(#${GRADIENT_ID})`}
              isAnimationActive={isAnimationActive}
              animationDuration={ANIMATION_DURATION}
              activeDot={{
                r: 5,
                fill: "var(--accent-hover)",
                stroke: "var(--bg-base)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

interface RechartsTooltipShape {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { day?: string } }>;
}

function PerfTooltip(props: RechartsTooltipShape) {
  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }
  const entry = props.payload[0];
  const day = entry?.payload?.day ?? "";
  const count = typeof entry?.value === "number" ? entry.value : 0;
  return (
    <Card className="px-3 py-2">
      <Eyebrow>{formatTooltipDay(day)}</Eyebrow>
      <p className="mt-1 text-body-sm font-medium text-[var(--text-primary)]">
        {count.toLocaleString()} {count === 1 ? "reply" : "replies"}
      </p>
    </Card>
  );
}

function formatTickDay(d: string): string {
  // YYYY-MM-DD → "Mon" short label
  const date = new Date(`${d}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function formatTooltipDay(d: string): string {
  if (!d) return "";
  const date = new Date(`${d}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
