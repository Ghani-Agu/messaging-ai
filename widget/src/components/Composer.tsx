import { h } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { ConversationState } from "../types";
import { isRtlText } from "../rtl";

export function Composer({
  draft,
  status,
  onChange,
  onSend,
  autoFocus,
}: {
  draft: string;
  status: ConversationState;
  onChange: (text: string) => void;
  onSend: () => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Live dir flip on the textarea so AR / Darija-Arabic-script input
  // anchors right correctly as the customer types. Re-evaluated per
  // keystroke via the memoized derivation, not via a synthetic event.
  const dir = useMemo(() => (isRtlText(draft) ? "rtl" : "ltr"), [draft]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Auto-grow up to the CSS max-height — keeps tall messages readable
  // before the textarea hits its scroll cap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  const disabled = status === "sending" || status === "streaming" || draft.trim().length === 0;

  return (
    <form
      class="composer"
      role="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSend();
      }}
    >
      <textarea
        ref={ref}
        dir={dir}
        rows={1}
        placeholder="Ask anything"
        aria-label="Type your message"
        value={draft}
        onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!disabled) onSend();
          }
        }}
        disabled={status === "error"}
      />
      <button
        type="submit"
        class="send-btn"
        aria-label="Send message"
        disabled={disabled}
      >
        Send
      </button>
    </form>
  );
}
