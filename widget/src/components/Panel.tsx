import { h } from "preact";
import type { ConversationState, Message } from "../types";
import type { WidgetStreamErrorKind } from "../api";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

const ERROR_BANNER_COPY: Record<WidgetStreamErrorKind, string> = {
  channel_paused: "Support is currently offline — please try again shortly",
  connection_lost: "Connection lost — please try again",
};

export function Panel({
  tenantName,
  status,
  errorKind,
  messages,
  draft,
  onClose,
  onDraftChange,
  onSend,
}: {
  tenantName: string;
  status: ConversationState;
  errorKind: WidgetStreamErrorKind | null;
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
          {ERROR_BANNER_COPY[errorKind ?? "connection_lost"]}
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
