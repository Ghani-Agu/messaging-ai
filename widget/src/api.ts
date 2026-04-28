import type { StreamEvent, StreamRequest } from "./types";
import { CANNED_REPLIES, pickCannedShape } from "./mock-data";

/**
 * Stream a customer message through the widget API.
 *
 * Locked wire shape (Phase-5 commit 3):
 *   POST /api/widget/messages
 *   body:     StreamRequest (see types.ts)
 *   response: text/event-stream-shaped chunks over a regular HTTP response
 *   events:   { type: "delta", text } | { type: "done", ...payload }
 *
 * Currently a four-shape mock — pattern-matches the customer's message
 * (mirroring the Phase-4 StubClaudeClient branches) and streams back the
 * matching canned shape. Real fetch + ReadableStream parser at
 * integration (commit 6); the streamMessage() signature does not change.
 */
export async function* streamMessage(
  req: StreamRequest,
): AsyncGenerator<StreamEvent> {
  const shape = pickCannedShape(req.message);
  const canned = CANNED_REPLIES[shape];
  const reply = canned.reply;

  // Initial think-time so the typing indicator gets a chance to render.
  await sleep(450);

  // Stream the reply ~8 chars per chunk. Chunk boundaries are codepoint-
  // safe because we slice the array we get from `[...reply]` rather than
  // the raw string — important for Arabic / Darija scripts.
  const codepoints = [...reply];
  const chunkSize = 8;
  for (let i = 0; i < codepoints.length; i += chunkSize) {
    yield { type: "delta", text: codepoints.slice(i, i + chunkSize).join("") };
    await sleep(35);
  }

  yield {
    type: "done",
    conversationId: deriveMockConversationId(req),
    reply,
    language: canned.language,
    citations: canned.citations,
    computedConfidence: canned.computedConfidence,
    escalation: canned.escalation,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stable across consecutive sends in a single browser session so the
 * 24h conversation-resume path is exercisable in the demo. Real server
 * uses Conversation.id (uuid).
 */
function deriveMockConversationId(req: StreamRequest): string {
  if (req.conversationId) return req.conversationId;
  return `mock-conv-${req.customerExternalId.slice(0, 8)}`;
}
