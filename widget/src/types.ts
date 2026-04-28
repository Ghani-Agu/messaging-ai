/**
 * Widget-side types. Some shapes mirror server-side equivalents (Citation,
 * SupportedLanguage, EscalationReason) — they're declared independently
 * here because the widget builds in isolation and cannot import from
 * src/. Update both sides together when the wire shape changes.
 */

export type SupportedLanguage = "ar" | "fr" | "en" | "darija";

export type EscalationReason =
  | "LOW_CONFIDENCE"
  | "NEGATIVE_SENTIMENT"
  | "EXPLICIT_REQUEST"
  | "OUTSIDE_SCOPE"
  | "PAYMENT_DISPUTE";

export type ConversationState = "idle" | "sending" | "streaming" | "error";

export type Citation = {
  /** 1-based, matches the index Claude returned in citations_used. */
  index: number;
  sourceName: string;
  sourceUrl?: string;
  preview: string;
};

export type Message = {
  id: string;
  role: "customer" | "ai";
  text: string;
  /** True while the AI bubble is mid-stream; flipped to false on `done`. */
  streaming?: boolean;
  /** Set on AI messages once `done` arrives — drives RTL detection. */
  lang?: SupportedLanguage;
  citations?: Citation[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Wire protocol — locked at Phase-5 commit 3.
//
// Endpoint: POST /api/widget/messages
// Request body: StreamRequest below
// Response:    text/event-stream-shaped chunks over a regular HTTP response
//              (single fetch, response.body is a ReadableStream the client
//              parses event-by-event)
// Events:      StreamEvent below — `delta` carries text fragments,
//              `done` carries the final structured payload
//
// mockBrainStream (commit 4) emits exactly these shapes so commit 6
// (integration) is a wire swap, not a redesign.
// ─────────────────────────────────────────────────────────────────────────────

export type StreamRequest = {
  /** Public widget key from the host page's <script data-key="..."> */
  widgetKey: string;
  /**
   * Server resumes this conversation if it exists, is ACTIVE, and its
   * lastMessageAt is within CONVERSATION_RESUME_MAX_AGE_MS. Otherwise
   * the server creates a new Conversation and returns its id in `done`.
   */
  conversationId?: string | null;
  message: string;
  /** Anonymous UUID minted + persisted in localStorage by the widget. */
  customerExternalId: string;
};

export type StreamDelta = {
  type: "delta";
  text: string;
};

export type StreamDone = {
  type: "done";
  conversationId: string;
  reply: string;
  language: SupportedLanguage;
  citations: Citation[];
  /** Deterministic, computed by the orchestrator (not Claude). 0..1. */
  computedConfidence: number;
  /** null means no escalation. */
  escalation: EscalationReason | null;
};

export type StreamEvent = StreamDelta | StreamDone;
