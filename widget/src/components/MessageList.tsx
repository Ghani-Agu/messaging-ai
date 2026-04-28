import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ConversationState, Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { TypingDots } from "./TypingDots";

export function MessageList({
  messages,
  status,
}: {
  messages: Message[];
  status: ConversationState;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Stick to the bottom on new messages or stream deltas. The user can
  // still scroll up — we only auto-scroll if they're already near the
  // bottom (within 80px) so reading older history isn't interrupted.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, status]);

  if (messages.length === 0) {
    return (
      <div class="messages" ref={ref}>
        <div class="empty">Ask anything — we're here to help.</div>
      </div>
    );
  }

  return (
    <div class="messages" ref={ref}>
      {messages.map((m) => (
        <MessageBubble key={m.id} m={m} />
      ))}
      {status === "sending" ? <TypingDots /> : null}
    </div>
  );
}
