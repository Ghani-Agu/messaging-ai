import "server-only";

/**
 * Server-side widget channel limits. Mirrored client-side in
 * widget/src/limits.ts — keep both files in sync. Same value with the
 * same comment on each side; the comment cites the other.
 */

/**
 * If the customer's most recent ACTIVE conversation has a
 * lastMessageAt within this window, the widget endpoint continues it;
 * otherwise it starts a fresh Conversation row. Mirrored client-side in
 * widget/src/limits.ts.
 */
export const CONVERSATION_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;
