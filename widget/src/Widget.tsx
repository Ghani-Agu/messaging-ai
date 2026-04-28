import { h, Fragment } from "preact";
import { useEffect, useReducer, useRef } from "preact/hooks";
import { subscribe } from "./api-bus";
import { streamMessage } from "./api";
import { Launcher } from "./components/Launcher";
import { Panel } from "./components/Panel";
import { CONVERSATION_RESUME_MAX_AGE_MS } from "./limits";
import type { ConversationState, Message, StreamEvent } from "./types";

/**
 * Top-level widget component. Owns:
 *   - the state machine (open/closed × idle/sending/streaming/error)
 *   - the localStorage-backed customerExternalId
 *   - the conversationId resume window (24h, mirrored server-side in
 *     src/server/channels/widget/limits.ts)
 *   - the bridge from the public window.MessagingAI API (via api-bus)
 *
 * Does NOT own:
 *   - the wire format (types.ts)
 *   - the actual fetch / streaming (api.ts — currently mocked)
 */

type State = {
  open: boolean;
  status: ConversationState;
  messages: Message[];
  draft: string;
  conversationId: string | null;
};

type Action =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "draft"; text: string }
  | { type: "send" }
  | { type: "ai/start" }
  | { type: "ai/delta"; text: string }
  | { type: "ai/done"; final: Message; conversationId: string }
  | { type: "ai/error" }
  | { type: "demo/seed"; messages: Message[]; status?: ConversationState };

const INITIAL: State = {
  open: false,
  status: "idle",
  messages: [],
  draft: "",
  conversationId: null,
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "open":   return { ...s, open: true };
    case "close":  return { ...s, open: false };
    case "toggle": return { ...s, open: !s.open };
    case "draft":  return { ...s, draft: a.text };
    case "send": {
      const text = s.draft.trim();
      if (!text) return s;
      const user: Message = { id: rid(), role: "customer", text };
      return { ...s, draft: "", status: "sending", messages: [...s.messages, user] };
    }
    case "ai/start":
      return {
        ...s,
        status: "streaming",
        messages: [...s.messages, { id: rid(), role: "ai", text: "", streaming: true }],
      };
    case "ai/delta": {
      const last = s.messages[s.messages.length - 1];
      if (!last || last.role !== "ai" || !last.streaming) return s;
      const updated: Message = { ...last, text: last.text + a.text };
      return { ...s, messages: [...s.messages.slice(0, -1), updated] };
    }
    case "ai/done":
      return {
        ...s,
        status: "idle",
        conversationId: a.conversationId,
        messages: [...s.messages.slice(0, -1), a.final],
      };
    case "ai/error":
      return { ...s, status: "error" };
    case "demo/seed":
      return { ...s, messages: a.messages, status: a.status ?? s.status };
  }
}

export function Widget({ widgetKey, tenantName }: { widgetKey: string | null; tenantName: string }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const customerExternalId = useRef(getOrMintCustomerId());
  const lastActivityAt = useRef<number>(loadLastActivity());

  // Bridge window.MessagingAI → component state via the api-bus.
  useEffect(() => {
    return subscribe((action) => {
      if (action.type === "open" || action.type === "close" || action.type === "toggle") {
        dispatch({ type: action.type });
      }
      // identify() is recorded for the eventual "merge anonymous → known"
      // flow (Phase 8). For now it's a no-op surface that won't crash the
      // host page.
    });
  }, []);

  // When the user sends, kick off the streaming call.
  useEffect(() => {
    if (state.status !== "sending") return;
    const cancel = runStream({
      widgetKey,
      conversationId: resolveConversationId(state.conversationId, lastActivityAt.current),
      message: state.messages[state.messages.length - 1]?.text ?? "",
      customerExternalId: customerExternalId.current,
      dispatch,
      onActivity: () => {
        lastActivityAt.current = Date.now();
        saveLastActivity(lastActivityAt.current);
      },
    });
    return cancel;
  }, [state.status]);

  return (
    <Fragment>
      {!state.open ? (
        <Launcher onClick={() => dispatch({ type: "open" })} />
      ) : (
        <Panel
          tenantName={tenantName}
          status={state.status}
          messages={state.messages}
          draft={state.draft}
          onClose={() => dispatch({ type: "close" })}
          onDraftChange={(text) => dispatch({ type: "draft", text })}
          onSend={() => dispatch({ type: "send" })}
        />
      )}
    </Fragment>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming bridge — wraps the api.ts AsyncGenerator and dispatches
// reducer actions per event. Cancellable so unmount mid-stream is safe.
// ─────────────────────────────────────────────────────────────────────────────

function runStream(args: {
  widgetKey: string | null;
  conversationId: string | null;
  message: string;
  customerExternalId: string;
  dispatch: (a: Action) => void;
  onActivity: () => void;
}): () => void {
  let cancelled = false;
  (async () => {
    try {
      const stream = streamMessage({
        widgetKey: args.widgetKey ?? "",
        conversationId: args.conversationId,
        message: args.message,
        customerExternalId: args.customerExternalId,
      });

      let started = false;
      for await (const event of stream as AsyncGenerator<StreamEvent>) {
        if (cancelled) return;
        if (event.type === "delta") {
          if (!started) {
            args.dispatch({ type: "ai/start" });
            started = true;
          }
          args.dispatch({ type: "ai/delta", text: event.text });
        } else {
          if (!started) args.dispatch({ type: "ai/start" });
          const final: Message = {
            id: rid(),
            role: "ai",
            text: event.reply,
            lang: event.language,
            citations: event.citations.length > 0 ? event.citations : undefined,
          };
          args.dispatch({
            type: "ai/done",
            final,
            conversationId: event.conversationId,
          });
          args.onActivity();
        }
      }
    } catch (err) {
      if (cancelled) return;
      console.error("[messaging-ai widget] stream error:", err);
      args.dispatch({ type: "ai/error" });
    }
  })();
  return () => {
    cancelled = true;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers — anonymous customer identity + 24h conversation
// resume window. Falls back gracefully if localStorage is unavailable
// (third-party-cookie restrictions on cross-origin embeds).
// ─────────────────────────────────────────────────────────────────────────────

const LS_CUSTOMER_KEY = "ma:customerExternalId";
const LS_LAST_ACTIVITY_KEY = "ma:lastActivityAt";

function getOrMintCustomerId(): string {
  try {
    const existing = localStorage.getItem(LS_CUSTOMER_KEY);
    if (existing) return existing;
    const fresh = rid();
    localStorage.setItem(LS_CUSTOMER_KEY, fresh);
    return fresh;
  } catch {
    return rid(); // session-only fallback
  }
}

function loadLastActivity(): number {
  try {
    const raw = localStorage.getItem(LS_LAST_ACTIVITY_KEY);
    return raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function saveLastActivity(ts: number): void {
  try {
    localStorage.setItem(LS_LAST_ACTIVITY_KEY, String(ts));
  } catch {
    // ignore — fall through to session-only behavior
  }
}

/**
 * If the last server-confirmed activity was within the 24h resume window,
 * reuse the conversationId; otherwise pass null so the server starts a
 * new Conversation row. Mirrored on the server in
 * src/server/channels/widget/limits.ts.
 */
function resolveConversationId(
  current: string | null,
  lastActivityAt: number,
): string | null {
  if (!current) return null;
  if (Date.now() - lastActivityAt > CONVERSATION_RESUME_MAX_AGE_MS) return null;
  return current;
}

function rid(): string {
  return crypto.randomUUID();
}
