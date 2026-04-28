import type { Citation, EscalationReason, Message, SupportedLanguage } from "./types";

/**
 * Mock fixtures for the demo gate. Drives both:
 *   1. streamMessage() in api.ts — pattern-matches the customer's
 *      message and returns one of the four canned shapes below
 *      (mirrors the Phase-4 StubClaudeClient branches).
 *   2. DemoControls in components/DemoControls.tsx — seeds the
 *      message list with a pre-built conversation (including Darija
 *      RTL fixtures) so the rendering paths can be eyeballed
 *      without typing.
 *
 * When integration lands (commit 6), the dispatcher in api.ts is
 * replaced by a real fetch + ReadableStream parser. The four shapes
 * here become regression cases for the eval harness.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. The four canned `done` payloads — one per Phase-4 stub branch.
//    streamMessage() picks one based on the customer's message.
// ─────────────────────────────────────────────────────────────────────────────

export type CannedShape =
  | "happy"
  | "outside-scope"
  | "explicit-request"
  | "payment-dispute";

type CannedReply = {
  shape: CannedShape;
  reply: string;
  language: SupportedLanguage;
  citations: Citation[];
  computedConfidence: number;
  escalation: EscalationReason | null;
};

const CITATIONS_HAPPY: Citation[] = [
  {
    index: 1,
    sourceName: "shipping-policy.pdf",
    sourceUrl: "https://example.com/shipping",
    preview:
      "Standard shipping to Algiers: 350 DZD, 2–3 business days. Free over 5,000 DZD.",
  },
  {
    index: 2,
    sourceName: "faq.example.com",
    sourceUrl: "https://example.com/faq",
    preview: "Most orders ship same day if placed before 3pm local time.",
  },
];

export const CANNED_REPLIES: Record<CannedShape, CannedReply> = {
  happy: {
    shape: "happy",
    reply:
      "Sure — standard shipping to Algiers costs 350 DZD and arrives in 2–3 business days. Orders over 5,000 DZD ship free.",
    language: "en",
    citations: CITATIONS_HAPPY,
    computedConfidence: 0.78,
    escalation: null,
  },
  "outside-scope": {
    shape: "outside-scope",
    reply:
      "Désolé, je n'ai pas cette information sous la main. Je peux vous mettre en relation avec un membre de l'équipe.",
    language: "fr",
    citations: [],
    computedConfidence: 0.18,
    escalation: "OUTSIDE_SCOPE",
  },
  "explicit-request": {
    shape: "explicit-request",
    // Darija-Arabizi (Latin + numerals 3/7/9 standing in for ع/ح/ق).
    reply: "Bien sûr — ghadi nwesslek 3la wa7ed men l-équipe daba.",
    language: "darija",
    citations: [],
    computedConfidence: 0.32,
    escalation: "EXPLICIT_REQUEST",
  },
  "payment-dispute": {
    shape: "payment-dispute",
    // Arabic-script Darija — RTL bubble.
    reply: "فهمتك، أنا آسف. واحد من الفريق غادي يتابع معاك دابا.",
    language: "darija",
    citations: [],
    computedConfidence: 0.21,
    escalation: "PAYMENT_DISPUTE",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pattern dispatcher used by streamMessage().
//    Mirrors the Phase-4 StubClaudeClient regexes so behaviour matches
//    end-to-end. NEW: customer messages in Darija (Arabizi or
//    Arabic-script with dialect markers) are also pattern-matched so the
//    RTL path renders organically when the user types in either script.
// ─────────────────────────────────────────────────────────────────────────────

const REFUND_RE = /(rembours|refund|inacceptable|scandale|dispute|chargeback)/i;
const HUMAN_RE = /\b(human|agent|manager|humain|conseiller|بشري|مدير|wa7ed|واحد)\b/i;
const ARABIC_SCRIPT_RE = /[؀-ۿݐ-ݿ]/;
const ARABIZI_MARKERS_RE =
  /\b(?:wach|kayan|kifash|rana|3andkom|bezzaf|khouya|khdma|blasa)\b/i;

export function pickCannedShape(message: string): CannedShape {
  if (REFUND_RE.test(message)) return "payment-dispute";
  if (HUMAN_RE.test(message)) return "explicit-request";
  // Anything else with strong topical signal goes to happy. Empty / off
  // topic / single-word "hello" go to outside-scope so the demo shows
  // both paths organically.
  const looksTopical =
    /\b(ship|deliver|cost|price|hour|address|return|warranty|payment)/i.test(message) ||
    /(livraison|prix|adresse|retour|garantie|paiement|horaires)/i.test(message) ||
    ARABIZI_MARKERS_RE.test(message) ||
    ARABIC_SCRIPT_RE.test(message);
  return looksTopical ? "happy" : "outside-scope";
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pre-seeded conversation history for the demo gate. Includes one
//    Darija-Arabizi exchange and one Arabic-script Darija exchange so the
//    RTL CSS path renders during walkthrough — the bug-catching point
//    of revision #5.
// ─────────────────────────────────────────────────────────────────────────────

export const SEEDED_HISTORY: Message[] = [
  {
    id: "seed-1",
    role: "customer",
    text: "Hi! What are your shipping costs to Algiers?",
  },
  {
    id: "seed-2",
    role: "ai",
    lang: "en",
    text: CANNED_REPLIES.happy.reply,
    citations: CANNED_REPLIES.happy.citations,
  },
  // Darija-Arabizi (Latin + numerals). Customer LTR, AI LTR.
  {
    id: "seed-3",
    role: "customer",
    text: "wach 3andkom des promotions hadi simana?",
  },
  {
    id: "seed-4",
    role: "ai",
    lang: "darija",
    text: "Iyeh, kayan -20% 3la les sacs jusqu'à dimanche.",
  },
  // Arabic-script Darija. Customer RTL, AI RTL — exercises the bubble
  // tail-flip CSS and the textarea dir flip when typing.
  {
    id: "seed-5",
    role: "customer",
    text: "واش عندكم وقت الخدمة؟",
  },
  {
    id: "seed-6",
    role: "ai",
    lang: "darija",
    text: "راه عندنا الخدمة من 9 صباحا حتى 7 مساء، من الإثنين للسبت.",
  },
];
