import "server-only";
import type { SystemBlock } from "./prompts/system";

/**
 * The boundary between the orchestrator and "an actual Claude call". The
 * orchestrator depends only on this interface; the stub (this file's
 * StubClaudeClient) and the future real wrapper (src/server/ai/claude.ts,
 * deferred until Anthropic credits arrive) both conform to it.
 *
 * RESUMPTION CHECKLIST (when credits land):
 *   1. Create src/server/ai/claude.ts exporting `class RealClaudeClient
 *      implements ClaudeClient`. Use native fetch + AbortSignal.timeout
 *      per CLAUDE.md §6 (no SDKs in worker paths). Implement sendReply
 *      first; defer streamReply until the playground UI is ready.
 *   2. Pin the dated Sonnet 4.6 snapshot — first run
 *      scripts/list-anthropic-models.ts and have the project lead pick.
 *      Default const overridable by env: ANTHROPIC_MODEL.
 *   3. Wire env: ANTHROPIC_API_KEY (already declared in §11).
 *   4. Swap getClaudeClient() below to return the real implementation
 *      whenever the env key is present, falling back to stub otherwise
 *      (so tests + dev-without-credits keep working).
 *   5. Run scripts/brain-eval.ts to validate the 8-row query bank.
 *   6. Then: build streaming route, playground UI, sidebar voice presets.
 */

// ─────────────────────────────────────────────────────────────────────────────
// send_reply tool — the contract
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedReplyLanguage = "ar" | "fr" | "en" | "darija";

export type EscalationReasonEnum =
  | "LOW_CONFIDENCE"
  | "NEGATIVE_SENTIMENT"
  | "EXPLICIT_REQUEST"
  | "OUTSIDE_SCOPE"
  | "PAYMENT_DISPUTE";

/**
 * The shape Claude must return via the forced `send_reply` tool call.
 * Mirrors exactly the JSON Schema we send in `tools[]`.
 */
export type SendReplyToolArgs = {
  reply: string;
  language: SupportedReplyLanguage;
  /**
   * Self-reported support level: 1.0 if every claim in the reply is
   * directly supported by a citation, 0.0 if no citation supports any
   * claim.
   */
  groundedness: number;
  /** 1-based indices into the citations array sent in the user turn. */
  citations_used: number[];
  escalation_recommended: boolean;
  /** Required iff escalation_recommended is true. */
  escalation_reason?: EscalationReasonEnum;
};

/**
 * The JSON Schema we ship as `tools[0].input_schema`. Exported so the
 * real wrapper can pass it without redefining the shape.
 */
export const SEND_REPLY_TOOL = {
  name: "send_reply",
  description:
    "Send a reply to the customer. You must call this — never output free text.",
  input_schema: {
    type: "object",
    required: [
      "reply",
      "language",
      "groundedness",
      "citations_used",
      "escalation_recommended",
    ],
    properties: {
      reply: { type: "string" },
      language: { type: "string", enum: ["ar", "fr", "en", "darija"] },
      groundedness: { type: "number", minimum: 0, maximum: 1 },
      citations_used: { type: "array", items: { type: "integer", minimum: 1 } },
      escalation_recommended: { type: "boolean" },
      escalation_reason: {
        type: "string",
        enum: [
          "LOW_CONFIDENCE",
          "NEGATIVE_SENTIMENT",
          "EXPLICIT_REQUEST",
          "OUTSIDE_SCOPE",
          "PAYMENT_DISPUTE",
        ],
      },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Client interface
// ─────────────────────────────────────────────────────────────────────────────

export type SendReplyArgs = {
  /** Multi-block system prompt. Future: mark Block A/B with cache_control. */
  system: SystemBlock[];
  /** Single user turn carrying citations + history + new message. */
  userMessage: string;
  /** Hard cap. Performance budget: 600 (Phase-4 Gate-1 §6). */
  maxTokens: number;
};

export type SendReplyResult = {
  toolArgs: SendReplyToolArgs;
  /** Diagnostic — populated by the real client. Stub returns "stub". */
  modelId: string;
  /** Diagnostic — null from the stub. */
  usage: { inputTokens: number; outputTokens: number } | null;
};

/**
 * Streaming events the future real client will emit. Listed here so the
 * orchestrator/route author has a stable target before Phase 4 resumes.
 * Stub does NOT implement streamReply — it throws NotImplementedError
 * (see resumption checklist).
 */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: SendReplyResult };

export interface ClaudeClient {
  sendReply(args: SendReplyArgs): Promise<SendReplyResult>;
  /**
   * Streaming variant. The stub raises `NotImplementedError`; the real
   * client implements this when the streaming route lands. Kept on the
   * interface so the boundary is stable.
   */
  streamReply?(args: SendReplyArgs): AsyncIterable<StreamEvent>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub implementation
//
// Returns deterministic canned `send_reply` shapes based on simple input
// patterns — enough to drive the downstream playground / widget without an
// API key. Each branch is dispatched off the `userMessage` content (Block C),
// which contains the literal customer message after the "NEW CUSTOMER
// MESSAGE" header. The stub doesn't try to be clever — it's enough to
// exercise every output shape (happy path / off-topic / refund / explicit
// human request / Darija both scripts) the orchestrator + UI care about.
// ─────────────────────────────────────────────────────────────────────────────

const ARABIZI_RE = /\b(?:wach|kayan|kifash|rana|3andkom|bezzaf|khouya|khdma|blasa)\b/i;
const ARABIC_SCRIPT_RE = /[؀-ۿ]/;
const FRENCH_RE = /\b(?:bonjour|merci|s'il vous plaît|quel|votre|vos|comment)\b/i;
const REFUND_RE = /(rembours|refund|inacceptable|scandale|lawyer|legal action)/i;
const HUMAN_RE = /\b(human|agent|manager|humain|conseiller|مدير|واحد بشري)\b/i;

function detectLanguageStub(message: string): SupportedReplyLanguage {
  if (ARABIZI_RE.test(message)) return "darija";
  if (ARABIC_SCRIPT_RE.test(message)) {
    // crude split: Darija uses dialect markers; otherwise call it MSA.
    if (/(واش|كيفاش|راني|راح|بزاف)/.test(message)) return "darija";
    return "ar";
  }
  if (FRENCH_RE.test(message)) return "fr";
  return "en";
}

function extractCustomerMessage(userMessage: string): string {
  const marker = "NEW CUSTOMER MESSAGE\n";
  const idx = userMessage.indexOf(marker);
  if (idx === -1) return userMessage;
  const after = userMessage.slice(idx + marker.length);
  // The block ends with a literal "\n\nReply now via send_reply." — strip it.
  return after.replace(/\n+Reply now via send_reply\.\s*$/, "").trim();
}

function countCitations(userMessage: string): number {
  // Block C numbers citations as `[1] ...`, `[2] ...`. Count those headers.
  const matches = userMessage.match(/\n\[(\d+)\]\s/g);
  return matches ? matches.length : 0;
}

export class StubClaudeClient implements ClaudeClient {
  async sendReply(args: SendReplyArgs): Promise<SendReplyResult> {
    const customerMessage = extractCustomerMessage(args.userMessage);
    const language = detectLanguageStub(customerMessage);
    const numCitations = countCitations(args.userMessage);

    let toolArgs: SendReplyToolArgs;

    if (REFUND_RE.test(customerMessage)) {
      toolArgs = {
        reply: stubReplyRefund(language),
        language,
        groundedness: 0.2,
        citations_used: [],
        escalation_recommended: true,
        escalation_reason: "PAYMENT_DISPUTE",
      };
    } else if (HUMAN_RE.test(customerMessage)) {
      toolArgs = {
        reply: stubReplyHuman(language),
        language,
        groundedness: 0.1,
        citations_used: [],
        escalation_recommended: true,
        escalation_reason: "EXPLICIT_REQUEST",
      };
    } else if (numCitations === 0) {
      toolArgs = {
        reply: stubReplyOffTopic(language),
        language,
        groundedness: 0.0,
        citations_used: [],
        escalation_recommended: true,
        escalation_reason: "OUTSIDE_SCOPE",
      };
    } else {
      // Happy path: pretend Claude grounded the answer in citations 1..min(N,2).
      const used = numCitations >= 2 ? [1, 2] : [1];
      toolArgs = {
        reply: stubReplyGrounded(language, used.length),
        language,
        groundedness: 0.85,
        citations_used: used,
        escalation_recommended: false,
      };
    }

    return {
      toolArgs,
      modelId: "stub",
      usage: null,
    };
  }
}

// Per-language canned strings. Intentionally short and on-script so the
// playground's language-mirroring demo lands. Real replies will come from
// Claude; these are placeholders.

function stubReplyGrounded(lang: SupportedReplyLanguage, n: number): string {
  switch (lang) {
    case "fr":
      return `D'après nos informations, voici la réponse — basée sur ${n} source${n > 1 ? "s" : ""} de notre base de connaissances.`;
    case "ar":
      return `حسب المعلومات المتوفرة لدينا، إليك الإجابة — استناداً إلى ${n} مصدر${n > 1 ? "" : ""} من قاعدة معارفنا.`;
    case "darija":
      return `7asb les informations li 3andna, hada howa l-jawab — men ${n} masdar f base dyalna.`;
    case "en":
      return `Based on our information, here's the answer — drawn from ${n} source${n > 1 ? "s" : ""} in our knowledge base.`;
  }
}

function stubReplyOffTopic(lang: SupportedReplyLanguage): string {
  switch (lang) {
    case "fr":
      return "Désolé, je n'ai pas cette information sous la main. Je peux vous mettre en relation avec un membre de l'équipe.";
    case "ar":
      return "آسف، لا تتوفر لدي هذه المعلومة. هل تريد التواصل مع أحد أعضاء الفريق؟";
    case "darija":
      return "Smahli, ma 3andich had l-information. Tebghi nwessel-lek 3la wa7ed men l-équipe?";
    case "en":
      return "Sorry — I don't have that information on hand. I can connect you with a team member.";
  }
}

function stubReplyRefund(lang: SupportedReplyLanguage): string {
  switch (lang) {
    case "fr":
      return "Je comprends votre frustration. Un membre de l'équipe va prendre le relais immédiatement.";
    case "ar":
      return "أتفهم انزعاجك. سيتولى أحد أعضاء الفريق المتابعة معك على الفور.";
    case "darija":
      return "Fhamtek, ana asfa. Wa7ed men l-équipe ghadi yetabe3 m3ak daba.";
    case "en":
      return "I hear you. A team member will pick this up with you right away.";
  }
}

function stubReplyHuman(lang: SupportedReplyLanguage): string {
  switch (lang) {
    case "fr":
      return "Bien sûr — je vous mets en relation avec un membre de l'équipe.";
    case "ar":
      return "بالطبع — سأقوم بتحويلك إلى أحد أعضاء الفريق.";
    case "darija":
      return "Bien sûr — ghadi nwesslek 3la wa7ed men l-équipe.";
    case "en":
      return "Of course — connecting you with a team member now.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — single seam for swapping stub → real later
// ─────────────────────────────────────────────────────────────────────────────

let cached: ClaudeClient | null = null;

/**
 * Returns the active Claude client. Currently always the stub (Phase 4
 * partial). When the real wrapper lands, this becomes:
 *
 *   if (process.env.ANTHROPIC_API_KEY) return new RealClaudeClient(...);
 *   return new StubClaudeClient();
 *
 * — preserving the dev-without-credits and unit-test paths.
 */
export function getClaudeClient(): ClaudeClient {
  if (!cached) cached = new StubClaudeClient();
  return cached;
}

/** Test affordance: reset the cached client. Do not call from app code. */
export function __resetClaudeClientForTests(): void {
  cached = null;
}
