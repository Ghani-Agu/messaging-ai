import { h } from "preact";
import type { Message } from "../types";
import { Citations } from "./Citations";
import { isRtlText } from "../rtl";

export function MessageBubble({ m }: { m: Message }) {
  // RTL detection: prefer the explicit `lang` (set on AI bubbles via the
  // streaming `done` event), fall back to first-char Unicode probing for
  // customer messages that haven't been classified yet.
  const dir = m.lang
    ? m.lang === "ar" || m.lang === "darija"
      ? isArabicScript(m.text)
        ? "rtl"
        : "ltr"
      : "ltr"
    : isRtlText(m.text)
      ? "rtl"
      : "ltr";

  return (
    <div class={`bubble ${m.role}`} dir={dir}>
      <span>{m.text}</span>
      {m.streaming ? <span class="cursor" aria-hidden="true" /> : null}
      {m.citations && m.citations.length > 0 ? (
        <Citations items={m.citations} />
      ) : null}
    </div>
  );
}

// Note: Darija can be written in Arabizi (Latin + numerals 3/7/9 standing
// in for ع/ح/ق), in which case the script is LTR even though `lang` is
// "darija". Keep the script check separate from language so Arabizi
// messages render LTR.
function isArabicScript(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    // Arabic main + Arabic supplement + Arabic Extended-A
    if (code >= 0x0600 && code <= 0x06ff) return true;
    if (code >= 0x0750 && code <= 0x077f) return true;
    if (code >= 0x08a0 && code <= 0x08ff) return true;
    return false; // first non-whitespace char decided
  }
  return false;
}
