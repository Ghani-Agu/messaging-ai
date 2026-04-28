/**
 * RTL text detection helpers — used by Composer for live `dir` flipping
 * as the customer types, and by MessageBubble as a fallback when the
 * language hasn't been classified yet.
 *
 * "First strong character" heuristic, simpler than the Unicode bidi
 * algorithm but adequate for chat input where the customer is one
 * person, one language at a time. Whitespace and ASCII punctuation are
 * skipped so leading "!" or " " doesn't anchor the direction.
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
  // Basic Latin letters, plus a generous span covering most European
  // alphabets. Anything strong-LTR locks the direction.
  if (code >= 0x0041 && code <= 0x005a) return true;
  if (code >= 0x0061 && code <= 0x007a) return true;
  if (code >= 0x00c0 && code <= 0x024f) return true;
  return false;
}

/**
 * True iff the first strong character in `text` is RTL. Returns false
 * for empty / whitespace-only / digit-only inputs (chat composer
 * doesn't need to flip on raw "12345").
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
