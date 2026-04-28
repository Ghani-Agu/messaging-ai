/**
 * Widget-side limits. Mirrored on the server in
 * src/server/channels/widget/limits.ts — keep both files in sync. Same
 * value with the same comment on each side; the comment cites the other.
 */

/**
 * If the customer's most recent ACTIVE conversation has a
 * lastMessageAt within this window, the widget continues it; otherwise
 * the server starts a fresh Conversation row. Mirrored on the server in
 * src/server/channels/widget/limits.ts.
 */
export const CONVERSATION_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;
