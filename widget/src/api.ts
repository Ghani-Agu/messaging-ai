import type { StreamEvent, StreamRequest } from "./types";

/**
 * Stream a customer message through the widget API.
 *
 * Wire shape locked at Phase-5 commit c5b3e8b (types.ts):
 *   POST /api/widget/messages
 *   request:  StreamRequest
 *   response: text/event-stream-shaped chunks over a regular HTTP response
 *   events:   { type: "delta", text } | { type: "done", ...payload }
 *
 * Phase-6 commit (real fetch): the in-process mockBrainStream is gone
 * for this code path; streamMessage now hits the real route handler at
 * /api/widget/messages and parses its SSE-shaped response stream.
 *
 * The mock + DemoControls remain in mock-data.ts for offline tooling
 * and DEV-gated UI testing.
 */

export type WidgetStreamErrorKind = "channel_paused" | "connection_lost";

/**
 * Typed error thrown by streamMessage when the request fails or the
 * stream ends prematurely. The widget switches on `kind` to render the
 * right banner ("Support is currently offline" vs "Connection lost").
 */
export class WidgetStreamError extends Error {
  readonly kind: WidgetStreamErrorKind;
  readonly retryAfterSec: number | null;
  constructor(kind: WidgetStreamErrorKind, message: string, retryAfterSec: number | null = null) {
    super(message);
    this.name = "WidgetStreamError";
    this.kind = kind;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Request URL — relative path so the widget works on whatever origin
 * embeds it. The dev shell (vite at :5173) proxies /api/* to the
 * Next.js dev server (vite.config.ts).
 */
const WIDGET_MESSAGES_URL = "/api/widget/messages";

export async function* streamMessage(
  req: StreamRequest,
): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await fetch(WIDGET_MESSAGES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widgetKey: req.widgetKey,
        conversationId: req.conversationId ?? null,
        message: req.message,
        customerExternalId: req.customerExternalId,
      }),
    });
  } catch (err) {
    throw new WidgetStreamError(
      "connection_lost",
      `network error: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    let body: { error?: string; retryAfterSec?: number } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // ignore; body parse failure is itself a connection-lost signal
    }
    if (response.status === 503 && body.error === "channel_paused") {
      throw new WidgetStreamError(
        "channel_paused",
        "Support is currently offline",
        body.retryAfterSec ?? null,
      );
    }
    throw new WidgetStreamError(
      "connection_lost",
      `http ${response.status}: ${body.error ?? "unknown"}`,
    );
  }

  if (!response.body) {
    throw new WidgetStreamError("connection_lost", "empty response body");
  }

  // Parse text/event-stream-shaped frames: each event is "data: <JSON>\n\n".
  // The route handler emits one `data: ...` line per event with a trailing
  // double newline; we accumulate bytes and pull complete frames as they
  // arrive. Reaching end-of-stream without a `done` event = treated as
  // connection_lost (the route closes the stream without `done` on
  // mid-stream errors).
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const json = dataLine.slice("data: ".length);
        let event: StreamEvent;
        try {
          event = JSON.parse(json) as StreamEvent;
        } catch {
          continue; // malformed frame; skip
        }
        if (event.type === "done") sawDone = true;
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!sawDone) {
    throw new WidgetStreamError(
      "connection_lost",
      "stream ended without `done` event",
    );
  }
}
