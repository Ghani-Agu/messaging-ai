/**
 * RTL text detection — "first strong character" heuristic. Used by the
 * dashboard MessageBubble to render Arabic / Hebrew message content with
 * the correct `dir`. Mirrors widget/src/rtl.ts; kept duplicated because
 * the widget is a separate workspace built standalone (vite + preact),
 * and the dashboard cannot import from it without coupling builds.
 *
 * Whitespace, ASCII punctuation, and digits don't anchor the direction —
 * leading "!" or " " or "12345" should not flip a message.
 */

const ARABIC_RANGES: Array<[number, number]> = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0x08a0, 0x08ff], // Arabic Extended-A
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
];

const HEBREW_RANGE: [number, number] = [0x0590, 0x05ff];

function isStrongRtl(code: number): boolean {
  if (code >= HEBREW_RANGE[0] && code <= HEBREW_RANGE[1]) return true;
  for (const [lo, hi] of ARABIC_RANGES) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

function isStrongLtr(code: number): boolean {
  // Basic Latin letters + Latin-1 Supplement + Latin Extended-A/B span,
  // covering most European alphabets. Anything strong-LTR locks LTR.
  if (code >= 0x0041 && code <= 0x005a) return true;
  if (code >= 0x0061 && code <= 0x007a) return true;
  if (code >= 0x00c0 && code <= 0x024f) return true;
  return false;
}

/**
 * True iff the first strong character in `text` is RTL. Returns false
 * for empty / whitespace-only / digit-only inputs.
 */
export function isRtlText(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (isStrongRtl(code)) return true;
    if (isStrongLtr(code)) return false;
  }
  return false;
}

/**
 * Best-effort decision for a known language tag. Darija can be Arabic-
 * script (RTL) or Arabizi (LTR Latin + numerals); when lang === "darija"
 * we fall back to script detection on the actual text. The dashboard
 * MessageBubble passes both `lang` and `text` for that reason.
 */
export function resolveDirection(args: {
  lang: string | null | undefined;
  text: string;
}): "ltr" | "rtl" {
  const { lang, text } = args;
  if (!lang) return isRtlText(text) ? "rtl" : "ltr";
  if (lang === "ar") return isRtlText(text) ? "rtl" : "ltr";
  if (lang === "darija") return isRtlText(text) ? "rtl" : "ltr";
  return "ltr";
}
