import "server-only";
import type { SystemBlock } from "./prompts/system";
import { detectLanguage } from "@/lib/language-detect";

/**
 * The boundary between the orchestrator and "an actual Claude call". The
 * orchestrator depends only on this interface; the stub (this file's
 * StubClaudeClient) and the real wrapper (src/server/ai/real-claude-client.ts,
 * lands in P4r-2) both conform to it.
 *
 * Phase 4 resumption status (P4r-1 — Foundation):
 *   - Pricing table:       src/server/ai/pricing.ts
 *   - Anthropic config:    src/server/ai/anthropic-config.ts
 *   - Typed errors:        src/server/ai/errors.ts
 *   - Test isolation:      VITEST guard + __setClaudeClientForTests below
 *   - Real client wiring:  P4r-2
 *   - Prompt caching:      P4r-3
 *   - streamReply:         P4r-4
 *   - structureItemsFromText against real Claude: P4r-5
 *   - brain-eval harness:  P4r-6
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
// structure_items tool — Phase 8c smart-import contract
//
// "Smart import" = operator pastes free-text catalog data, Claude
// structures it into KnowledgeItemInput-shaped rows, operator reviews +
// approves. The tool returns an array of partially-structured items;
// the Server Action layer maps to KnowledgeItemInput, the operator
// fills in any missing/wrong fields in the preview UI, then the
// commit action calls createItem one by one.
//
// Schema is intentionally LOOSE on the server side — Claude may guess
// some fields wrong (especially currency / availability), and we want
// the operator-correction UI to fire rather than rejecting the whole
// batch on a bad guess.
// ─────────────────────────────────────────────────────────────────────────────

export type StructuredItemDraft = {
  name: string;
  category?: string;
  brand?: string;
  sku?: string;
  currency?: string;
  /** Decimal price string from the source — converted to cents post-review. */
  price?: string;
  availability?: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  description?: string;
  /** Free-form spec key/value pairs Claude pulled out of the source. */
  specs?: Record<string, string>;
};

export type StructureItemsToolArgs = {
  items: StructuredItemDraft[];
  /** Diagnostic notes Claude returns about ambiguous fields, etc. */
  notes?: string;
};

export const SEND_STRUCTURED_ITEMS_TOOL = {
  name: "structure_items",
  description:
    "Convert free-text catalog data into structured items the operator can review and approve. Make a best-effort guess on each field; missing or unclear fields can be left undefined — the operator will fill them in.",
  input_schema: {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            brand: { type: "string" },
            sku: { type: "string" },
            currency: { type: "string" },
            price: { type: "string" },
            availability: {
              type: "string",
              enum: ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "UNKNOWN"],
            },
            description: { type: "string" },
            specs: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
      notes: { type: "string" },
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

export type StructureItemsArgs = {
  /** Operator-pasted free-text catalog data. May be messy. */
  text: string;
  /** Hard cap on items to return. Default 20 — keeps the preview UI bounded. */
  maxItems?: number;
};

export type StructureItemsResult = {
  toolArgs: StructureItemsToolArgs;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number } | null;
};

export interface ClaudeClient {
  sendReply(args: SendReplyArgs): Promise<SendReplyResult>;
  /**
   * Streaming variant. The stub raises `NotImplementedError`; the real
   * client implements this when the streaming route lands. Kept on the
   * interface so the boundary is stable.
   */
  streamReply?(args: SendReplyArgs): AsyncIterable<StreamEvent>;
  /**
   * Phase 8c smart-import. Returns structured item drafts for the
   * operator-review/edit/approve flow. The stub returns slightly-imperfect
   * results (one rotating-wrong field per call) so the correction UI gets
   * exercised broadly (Gate-1 K4).
   */
  structureItemsFromText?(args: StructureItemsArgs): Promise<StructureItemsResult>;
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

const REFUND_RE = /(rembours|refund|inacceptable|scandale|lawyer|legal action)/i;
const HUMAN_RE = /\b(human|agent|manager|humain|conseiller|مدير|واحد بشري)\b/i;

// Stub language detection now delegates to the shared detector in
// src/lib/language-detect.ts so the orchestrator and the stub use the
// same logic. The original regex set lived here in Phase 4.
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
    const language = detectLanguage(customerMessage);
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

  // Phase 8c smart-import stub. Returns 3 deterministic items pattern-
  // matched against the input text, with one rotating-wrong field per
  // call so the operator-correction UI is exercised broadly (Gate-1 K4).
  // The rotation cursor is a module-scoped counter (state lives on the
  // class instance for testability — __resetClaudeClientForTests resets
  // both the cached client and the rotation cursor).
  private rotationCursor = 0;

  async structureItemsFromText(args: StructureItemsArgs): Promise<StructureItemsResult> {
    const drafts = stubStructureItems(args.text, this.rotationCursor);
    this.rotationCursor = (this.rotationCursor + 1) % WRONG_FIELD_ROTATION.length;
    return {
      toolArgs: { items: drafts, notes: "stub: pattern-matched against keywords" },
      modelId: "stub",
      usage: null,
    };
  }
}

// Rotation list: each call returns drafts with this field deliberately
// missing/wrong. Operators editing the preview thus exercise every
// correction path over a session.
const WRONG_FIELD_ROTATION = [
  "currency", // missing currency on a priced item
  "availability", // wrong availability (IN_STOCK when description says "out")
  "price", // missing price
  "brand", // missing brand
  "sku", // missing sku
] as const;

function stubStructureItems(
  text: string,
  cursor: number,
): StructuredItemDraft[] {
  const wrongField = WRONG_FIELD_ROTATION[cursor % WRONG_FIELD_ROTATION.length]!;
  // Pattern-match a couple of common keywords so the preview shows
  // plausible items the operator can recognize. Default = 3 generic items.
  const lower = text.toLowerCase();
  const drafts: StructuredItemDraft[] = [];

  if (/macbook|laptop/.test(lower)) {
    drafts.push({
      name: "Macbook Pro M3",
      category: "laptops",
      brand: "Apple",
      sku: "MBP-M3-14",
      currency: "USD",
      price: "2200.00",
      availability: "IN_STOCK",
      description: "14-inch laptop with M3 chip.",
      specs: { ram: "16GB", storage: "512GB" },
    });
  }
  if (/iphone|phone/.test(lower)) {
    drafts.push({
      name: "iPhone 15",
      category: "phones",
      brand: "Apple",
      sku: "IP-15-128",
      currency: "USD",
      price: "799.00",
      availability: "IN_STOCK",
      description: "128GB smartphone.",
      specs: { color: "black" },
    });
  }
  if (/router|network/.test(lower)) {
    drafts.push({
      name: "Asus Router AC2900",
      category: "networking",
      brand: "Asus",
      sku: "ASUS-RT-AC2900",
      currency: "USD",
      price: "180.00",
      availability: "LOW_STOCK",
      description: "Dual-band wireless router.",
    });
  }

  // Fallback: 3 generic items so the preview UI always has something.
  while (drafts.length < 3) {
    const i = drafts.length + 1;
    drafts.push({
      name: `Sample Product ${i}`,
      category: "uncategorized",
      brand: "Generic",
      sku: `SAMPLE-${i}`,
      currency: "USD",
      price: `${(i * 100).toFixed(2)}`,
      availability: "UNKNOWN",
      description: `Sample item ${i} for smart-import preview.`,
    });
  }

  // Apply the rotating wrong-field — strip the chosen field on the FIRST
  // draft so the operator's edit path fires. (Other drafts unaffected so
  // a multi-item preview shows mixed accuracy.)
  if (drafts.length > 0) {
    const first = { ...drafts[0]! };
    if (wrongField === "availability") {
      first.availability = "IN_STOCK"; // potentially wrong vs description
    } else {
      delete (first as Record<string, unknown>)[wrongField];
    }
    drafts[0] = first;
  }
  return drafts;
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
// Factory — single seam for swapping stub → real
// ─────────────────────────────────────────────────────────────────────────────

let cached: ClaudeClient | null = null;

/**
 * Returns the active Claude client. Resolution order (Gate-1 K9):
 *
 *   1. If a test has injected a client via __setClaudeClientForTests →
 *      use that. Required for tests that need to assert specific client
 *      behavior (e.g. spy on sendReply args).
 *   2. If running under vitest (process.env.VITEST === "true") → stub,
 *      regardless of ANTHROPIC_API_KEY. Hard guard so the test suite
 *      cannot accidentally hit the real API and burn credits.
 *   3. If process.env.ANTHROPIC_API_KEY is set → real client (P4r-2+).
 *   4. Otherwise → stub. Lets dev work locally without credits.
 *
 * Future CI must NOT include ANTHROPIC_API_KEY in the test job's secrets
 * (CLAUDE.md §7a documents this); the VITEST guard is belt + suspenders.
 *
 * The real client is constructed lazily via dynamic import so importing
 * this module in test/dev does not pull `@anthropic-ai/sdk` into the
 * bundle when it isn't needed. P4r-2 wires the dynamic import; P4r-1
 * leaves the branch returning the stub with a clear marker.
 */
export function getClaudeClient(): ClaudeClient {
  if (cached) return cached;

  // Step 2: hard test guard. vitest sets VITEST=true automatically.
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    cached = new StubClaudeClient();
    return cached;
  }

  // Step 3: real client when credentials available. Wired in P4r-2 — for
  // P4r-1 we still return stub so the existing pipeline keeps working.
  if (process.env.ANTHROPIC_API_KEY) {
    // TODO(P4r-2): return new RealClaudeClient({ apiKey, modelId }).
    cached = new StubClaudeClient();
    return cached;
  }

  // Step 4: stub fallback for dev-without-credits.
  cached = new StubClaudeClient();
  return cached;
}

/** Test affordance: reset the cached client. Do not call from app code. */
export function __resetClaudeClientForTests(): void {
  cached = null;
}

/**
 * Test affordance: inject a specific client implementation (typically a
 * mock or a hand-rolled stub). Resets on the next __resetClaudeClientForTests
 * call. Not exported through any non-test surface.
 */
export function __setClaudeClientForTests(client: ClaudeClient): void {
  cached = client;
}
