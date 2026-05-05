import { z } from "zod";

/**
 * Shared schemas for the dashboard's activity timeline. The actual
 * Prisma queries that produce these events live in
 * src/server/db/dashboard-metrics.ts (server-only) — keeping the schema
 * here lets client components import `ActivityEvent` without crossing
 * the server-only boundary, per CLAUDE.md §4 lib/server split rule.
 *
 * Events are derived from creation timestamps on existing tables — the
 * schema does not (yet) model an explicit activity-event log. See the
 * derive() functions in dashboard-metrics for the per-kind sources.
 */

export const activityEventKindSchema = z.enum([
  "conversation_created",
  "escalation_flagged",
  "gap_logged",
  "item_verified",
]);
export type ActivityEventKind = z.infer<typeof activityEventKindSchema>;

const conversationCreatedSchema = z.object({
  kind: z.literal("conversation_created"),
  id: z.string(),
  timestamp: z.date(),
  customerName: z.string().nullable(),
  channelType: z.string(),
});

const escalationFlaggedSchema = z.object({
  kind: z.literal("escalation_flagged"),
  id: z.string(),
  timestamp: z.date(),
  reason: z.string().nullable(),
  customerName: z.string().nullable(),
});

const gapLoggedSchema = z.object({
  kind: z.literal("gap_logged"),
  id: z.string(),
  timestamp: z.date(),
  question: z.string(),
});

const itemVerifiedSchema = z.object({
  kind: z.literal("item_verified"),
  id: z.string(),
  timestamp: z.date(),
  itemName: z.string(),
});

export const activityEventSchema = z.discriminatedUnion("kind", [
  conversationCreatedSchema,
  escalationFlaggedSchema,
  gapLoggedSchema,
  itemVerifiedSchema,
]);
export type ActivityEvent = z.infer<typeof activityEventSchema>;

/** Shape of the metrics object the dashboard composes. */
export interface DashboardMetrics {
  /** Conversations created in the trailing 7 days. */
  conversationsThisWeek: number;
  /** Conversations created in the 7 days *before* that, for the delta label. */
  conversationsLastWeek: number;
  /** AI OUTBOUND messages sent in the trailing 7 days. */
  aiRepliesThisWeek: number;
  /**
   * (this-week conversations that didn't escalate) / (this-week conversations) × 100.
   * 0 when there are no this-week conversations.
   */
  aiAutoResolvedRate: number;
  /**
   * Average seconds between an INBOUND customer message and the next OUTBOUND
   * AI reply in the same conversation, over the trailing 7 days. 0 when no
   * such pairs exist.
   */
  avgResponseTimeSeconds: number;
  /**
   * Average of `aiMetadata.confidence` across AI messages in the trailing
   * 7 days, expressed as 0..100. 0 when no AI messages exist or when no
   * messages have a confidence field set.
   */
  aiConfidenceAverage: number;
  /** Conversations whose status flipped to HUMAN_HANDLING this week. */
  escalationsThisWeek: number;
  /**
   * AI OUTBOUND message counts per day for the last 7 days, oldest → newest.
   * The `day` field is a YYYY-MM-DD string (UTC).
   */
  repliesPerDay: Array<{ day: string; count: number }>;
  /**
   * Whether the tenant has any channel currently in CONNECTED status. Drives
   * the dashboard's empty-state vs active-state branching.
   */
  hasAnyChannelConnected: boolean;
}
