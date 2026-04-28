import { h } from "preact";
import type { ConversationState, Message } from "../types";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

export function Panel({
  tenantName,
  status,
  messages,
  draft,
  onClose,
  onDraftChange,
  onSend,
}: {
  tenantName: string;
  status: ConversationState;
  messages: Message[];
  draft: string;
  onClose: () => void;
  onDraftChange: (text: string) => void;
  onSend: () => void;
}) {
  return (
    <div class="panel" role="dialog" aria-label={`Chat with ${tenantName}`}>
      <header class="header">
        <div>
          <div class="header-title">{tenantName}</div>
          <div class="header-subtitle">Typically replies in a few seconds</div>
        </div>
        <button
          type="button"
          class="close-btn"
          aria-label="Close chat"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {status === "error" ? (
        <div class="error-banner" role="alert">
          Connection lost — please try again
        </div>
      ) : null}
      <MessageList messages={messages} status={status} />
      <Composer
        draft={draft}
        status={status}
        onChange={onDraftChange}
        onSend={onSend}
        autoFocus
      />
    </div>
  );
}
