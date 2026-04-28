import type { StreamEvent, StreamRequest } from "./types";

/**
 * Stream a customer message through the widget API.
 *
 * Locked wire shape (Phase-5 commit 3):
 *   POST /api/widget/messages
 *   body:     StreamRequest (see types.ts)
 *   response: text/event-stream-shaped chunks over a regular HTTP response
 *   events:   { type: "delta", text } | { type: "done", ...payload }
 *
 * Currently a minimal mock — emits a tiny canned reply so the component
 * tree compiles and the stream wiring is exercised end-to-end. Commit 4
 * replaces this with the four-shape mock that mirrors the Phase-4 stub
 * (happy / OUTSIDE_SCOPE / EXPLICIT_REQUEST / PAYMENT_DISPUTE) plus the
 * Darija RTL fixtures. Real fetch + ReadableStream parser at integration
 * (commit 6); the signature will not change.
 */
export async function* streamMessage(
  _req: StreamRequest,
): AsyncGenerator<StreamEvent> {
  // Tiny commit-3 placeholder reply.
  const reply = "Thanks for the message — the real backend lands at integration.";
  const chunkSize = 8;

  await sleep(300);
  for (let i = 0; i < reply.length; i += chunkSize) {
    yield { type: "delta", text: reply.slice(i, i + chunkSize) };
    await sleep(40);
  }
  yield {
    type: "done",
    conversationId: "mock-conversation-id",
    reply,
    language: "en",
    citations: [],
    computedConfidence: 0.0,
    escalation: "OUTSIDE_SCOPE",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
