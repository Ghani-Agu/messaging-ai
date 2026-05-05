import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import {
  type ActivityEvent,
  type DashboardMetrics,
} from "@/lib/dashboard-activity";

// Re-export for ergonomic imports server-side. Lib stays the source of truth.
export { type ActivityEvent, type DashboardMetrics };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

/**
 * Aggregate dashboard metrics for a tenant. Queries are scoped by tenantId
 * and bound to the trailing 7-day window (today − 7 days → now). Returns
 * zeros for empty tenants — the dashboard's empty-state branch decides
 * whether to render the OnboardingStrip prominently or the KPI grid.
 *
 * Per-week comparisons use the full 7×24h window (not calendar weeks) —
 * "last week" = the 7 days *before* this week.
 *
 * Notes on derivation:
 *   - "AI confidence" is read from Message.aiMetadata.confidence (Json).
 *     The brain orchestrator writes it on every AI reply (Phase 4). When
 *     a tenant has no AI replies yet, or none of their AI replies happen
 *     to carry the field, we return 0 with a comment.
 *   - "Escalations this week" counts conversations whose lastMessageAt
 *     is in the trailing 7d AND whose metadata carries
 *     `lastEscalationReason` (the orchestrator's marker — see
 *     conversation-detail-client's EscalationCallout for the read side).
 *     The schema doesn't have an explicit Escalation event log; this is
 *     the closest signal.
 */
export async function getDashboardMetrics(
  tenantId: string,
): Promise<DashboardMetrics> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - ONE_WEEK_MS);
  const twoWeeksAgo = new Date(now.getTime() - 2 * ONE_WEEK_MS);

  // Run all queries in parallel.
  const [
    conversationsThisWeek,
    conversationsLastWeek,
    aiRepliesThisWeek,
    autoResolvedAggregate,
    avgResponseRows,
    confidenceRows,
    escalationsThisWeek,
    perDayRows,
    connectedChannelsCount,
  ] = await Promise.all([
    prisma.conversation.count({
      where: { tenantId, createdAt: { gte: weekAgo } },
    }),
    prisma.conversation.count({
      where: { tenantId, createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
    }),
    prisma.message.count({
      where: {
        tenantId,
        sender: "AI",
        direction: "OUTBOUND",
        createdAt: { gte: weekAgo },
      },
    }),
    autoResolvedAggregateForTenant(tenantId, weekAgo),
    avgResponseTimeRows(tenantId, weekAgo),
    aiConfidenceAverageRows(tenantId, weekAgo),
    escalationsThisWeekCount(tenantId, weekAgo),
    repliesPerDayRows(tenantId, weekAgo),
    prisma.channel.count({
      where: { tenantId, status: "CONNECTED" },
    }),
  ]);

  const totalThisWeek = autoResolvedAggregate.total;
  const escalatedThisWeek = autoResolvedAggregate.escalated;
  const aiAutoResolvedRate =
    totalThisWeek === 0
      ? 0
      : Math.round(
          ((totalThisWeek - escalatedThisWeek) / totalThisWeek) * 100,
        );

  const avgResponseTimeSeconds = avgResponseRows[0]?.avg_seconds ?? 0;
  const aiConfidenceFloat = confidenceRows[0]?.avg_confidence ?? 0;
  const aiConfidenceAverage = Math.round(aiConfidenceFloat * 100);

  const repliesPerDay = fillDailyBuckets(perDayRows, weekAgo, now);

  return {
    conversationsThisWeek,
    conversationsLastWeek,
    aiRepliesThisWeek,
    aiAutoResolvedRate,
    avgResponseTimeSeconds: Math.round(avgResponseTimeSeconds),
    aiConfidenceAverage,
    escalationsThisWeek,
    repliesPerDay,
    hasAnyChannelConnected: connectedChannelsCount > 0,
  };
}

/**
 * Recent activity for the dashboard timeline. Pulls from four sources
 * (see ActivityEvent kinds), merges by timestamp desc, and slices to
 * the requested limit. The schema does not currently log activity
 * events explicitly — these are derived from each table's own
 * createdAt / lastVerifiedAt timestamps.
 */
export async function getRecentActivity(
  tenantId: string,
  limit = 10,
): Promise<ActivityEvent[]> {
  // Pull a slightly oversized window per source so the merge has enough
  // candidates for any timestamp ordering.
  const sourceLimit = Math.max(limit, 8);

  const [conversations, escalations, gaps, items] = await Promise.all([
    prisma.conversation.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: sourceLimit,
      select: {
        id: true,
        createdAt: true,
        customer: { select: { name: true } },
        channel: { select: { type: true } },
      },
    }),
    prisma.conversation.findMany({
      where: {
        tenantId,
        // metadata->>'lastEscalationReason' IS NOT NULL — Prisma's JSON
        // path filter handles this directly.
        metadata: { path: ["lastEscalationReason"], not: Prisma.JsonNull },
      },
      orderBy: { lastMessageAt: "desc" },
      take: sourceLimit,
      select: {
        id: true,
        lastMessageAt: true,
        metadata: true,
        customer: { select: { name: true } },
      },
    }),
    prisma.knowledgeGap.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: sourceLimit,
      select: { id: true, createdAt: true, question: true },
    }),
    prisma.knowledgeItem.findMany({
      where: { tenantId, lastVerifiedAt: { not: null } },
      orderBy: { lastVerifiedAt: "desc" },
      take: sourceLimit,
      select: { id: true, name: true, lastVerifiedAt: true },
    }),
  ]);

  const events: ActivityEvent[] = [
    ...conversations.map<ActivityEvent>((c) => ({
      kind: "conversation_created",
      id: `conv:${c.id}`,
      timestamp: c.createdAt,
      customerName: c.customer.name,
      channelType: c.channel.type,
    })),
    ...escalations.map<ActivityEvent>((c) => ({
      kind: "escalation_flagged",
      id: `esc:${c.id}`,
      timestamp: c.lastMessageAt,
      reason: readEscalationReason(c.metadata),
      customerName: c.customer.name,
    })),
    ...gaps.map<ActivityEvent>((g) => ({
      kind: "gap_logged",
      id: `gap:${g.id}`,
      timestamp: g.createdAt,
      question: g.question,
    })),
    // KnowledgeItem.lastVerifiedAt is filtered to non-null above, so the
    // values here are always defined. Narrow the type for the discriminated
    // union without an `any` cast.
    ...items
      .filter((i): i is typeof i & { lastVerifiedAt: Date } =>
        i.lastVerifiedAt !== null,
      )
      .map<ActivityEvent>((i) => ({
        kind: "item_verified",
        id: `item:${i.id}`,
        timestamp: i.lastVerifiedAt,
        itemName: i.name,
      })),
  ];

  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return events.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — kept private to this module
// ─────────────────────────────────────────────────────────────────────────────

interface AutoResolvedAggregate {
  total: number;
  escalated: number;
}

async function autoResolvedAggregateForTenant(
  tenantId: string,
  weekAgo: Date,
): Promise<AutoResolvedAggregate> {
  // Single query producing both numerator and denominator. Avoids a race
  // where the two counts disagree between calls.
  const rows = await prisma.$queryRaw<
    Array<{ total: bigint; escalated: bigint }>
  >`
    SELECT
      COUNT(*)::bigint                                        AS total,
      COUNT(*) FILTER (
        WHERE "status" = 'HUMAN_HANDLING'
           OR ("metadata" ->> 'lastEscalationReason') IS NOT NULL
      )::bigint                                               AS escalated
    FROM "Conversation"
    WHERE "tenantId" = ${tenantId}
      AND "createdAt" >= ${weekAgo}
  `;
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0n),
    escalated: Number(row?.escalated ?? 0n),
  };
}

async function avgResponseTimeRows(
  tenantId: string,
  weekAgo: Date,
): Promise<Array<{ avg_seconds: number }>> {
  // For each customer-inbound message in the window, find the next
  // AI-outbound message in the same conversation; average the deltas.
  const rows = await prisma.$queryRaw<Array<{ avg_seconds: number | null }>>`
    SELECT AVG(EXTRACT(EPOCH FROM (ai."createdAt" - cust."createdAt")))::float AS avg_seconds
    FROM "Message" cust
    JOIN LATERAL (
      SELECT m."createdAt"
      FROM "Message" m
      WHERE m."conversationId" = cust."conversationId"
        AND m."sender" = 'AI'
        AND m."direction" = 'OUTBOUND'
        AND m."createdAt" > cust."createdAt"
      ORDER BY m."createdAt" ASC
      LIMIT 1
    ) ai ON TRUE
    WHERE cust."tenantId" = ${tenantId}
      AND cust."sender" = 'CUSTOMER'
      AND cust."direction" = 'INBOUND'
      AND cust."createdAt" >= ${weekAgo}
  `;
  return rows.map((r) => ({ avg_seconds: r.avg_seconds ?? 0 }));
}

async function aiConfidenceAverageRows(
  tenantId: string,
  weekAgo: Date,
): Promise<Array<{ avg_confidence: number }>> {
  // Pulls AVG((aiMetadata->>'confidence')::float) — Postgres skips
  // NULLs in AVG, so messages without a confidence field don't drag
  // the average down. Returns 0 (not null) when there's no signal yet.
  const rows = await prisma.$queryRaw<
    Array<{ avg_confidence: number | null }>
  >`
    SELECT AVG((("aiMetadata" ->> 'confidence'))::float)::float AS avg_confidence
    FROM "Message"
    WHERE "tenantId" = ${tenantId}
      AND "sender" = 'AI'
      AND "createdAt" >= ${weekAgo}
      AND ("aiMetadata" ->> 'confidence') IS NOT NULL
  `;
  return rows.map((r) => ({ avg_confidence: r.avg_confidence ?? 0 }));
}

async function escalationsThisWeekCount(
  tenantId: string,
  weekAgo: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "Conversation"
    WHERE "tenantId" = ${tenantId}
      AND "lastMessageAt" >= ${weekAgo}
      AND (
        "status" = 'HUMAN_HANDLING'
        OR ("metadata" ->> 'lastEscalationReason') IS NOT NULL
      )
  `;
  return Number(rows[0]?.n ?? 0n);
}

async function repliesPerDayRows(
  tenantId: string,
  weekAgo: Date,
): Promise<Array<{ day: string; count: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; n: bigint }>
  >`
    SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS n
    FROM "Message"
    WHERE "tenantId" = ${tenantId}
      AND "sender" = 'AI'
      AND "direction" = 'OUTBOUND'
      AND "createdAt" >= ${weekAgo}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    count: Number(r.n),
  }));
}

/**
 * Fill out the 7-day window with zeros for any day that had no AI replies,
 * and return entries oldest → newest. Avoids a sparse chart in low-traffic
 * weeks.
 */
function fillDailyBuckets(
  rows: Array<{ day: string; count: number }>,
  weekAgo: Date,
  now: Date,
): Array<{ day: string; count: number }> {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, r.count);

  const out: Array<{ day: string; count: number }> = [];
  // Start at the day boundary 7 days ago and step forward by 24h.
  const start = new Date(weekAgo);
  start.setUTCHours(0, 0, 0, 0);
  for (
    let cursor = start.getTime();
    cursor <= now.getTime();
    cursor += ONE_DAY_MS
  ) {
    const d = new Date(cursor).toISOString().slice(0, 10);
    out.push({ day: d, count: byDay.get(d) ?? 0 });
  }
  // Cap to 7 entries — the loop can produce 8 across a DST/clock edge.
  return out.slice(-7);
}

function readEscalationReason(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)["lastEscalationReason"];
  return typeof value === "string" ? value : null;
}
