import "server-only";

/**
 * 24h customer-service window policy — channel-agnostic.
 *
 * Meta-family messaging (WhatsApp via 360dialog, Messenger, Instagram DMs)
 * enforces a hard rule: outside a 24-hour window from the customer's last
 * inbound message, free-form replies are blocked. The only way to re-engage
 * outside that window is via approved "template messages" (WhatsApp) or
 * "message tags" (Messenger / Instagram), each of which requires a separate
 * approval flow.
 *
 * The window length and semantics are identical across all three channels —
 * which is why this helper lives at the channel-agnostic layer (7a moved
 * it from src/server/channels/whatsapp/policy.ts to here without API
 * changes).
 *
 * Read-side check only (Phase 6 v1, applies to Phase 7 too):
 *
 *   - inside  → outbound send proceeds normally.
 *   - outside → AI reply is persisted (operator-visible in the dashboard,
 *               flagged with a "not delivered" indicator) but the provider
 *               call is skipped. No silent failure; the operator sees the
 *               draft AI reply and can act.
 *
 * Templates / tags + re-engagement land in Phase 6.5 (alongside the
 * WhatsApp template approval flow).
 *
 * The check is computed-on-read so the policy never goes stale: we don't
 * cache a "window open until X" timestamp on the conversation. Every
 * outbound-send hook re-derives `lastInboundAt` from
 * `Message.findFirst({ where: { conversationId, direction: 'INBOUND' },
 * orderBy: { createdAt: 'desc' } })` and feeds it to this helper.
 */

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * True iff `lastInboundAt` is within the last 24 hours from `now`. Returns
 * false when `lastInboundAt` is null (the conversation has never had an
 * inbound message) — the AI is never the one to start a conversation in
 * v1, so a null inbound timestamp means we shouldn't be sending anything
 * either way.
 *
 * `now` defaults to `Date.now()`; tests pass an explicit value so the
 * boundary cases are deterministic.
 */
export function isWithinCustomerServiceWindow(
  lastInboundAt: Date | null,
  now: number = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  return now - lastInboundAt.getTime() < CUSTOMER_SERVICE_WINDOW_MS;
}
