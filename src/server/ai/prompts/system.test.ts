import { describe, expect, it } from "vitest";
import { Tiktoken } from "js-tiktoken/lite";
import cl100kBase from "js-tiktoken/ranks/cl100k_base";
import { defaultVoiceProfile } from "../../../lib/validators";
import {
  BLOCK_A_TEXT,
  buildBlockA,
  buildBlockB,
  buildBlockC,
  buildPrompt,
} from "./system";

// cl100k_base (gpt-4 tokenizer) is the closest publicly available
// approximation to Claude's tokenizer. Within ±5–10% on natural prose;
// good enough to enforce a budget. Final number gets re-verified via
// Anthropic's count_tokens endpoint when the real wrapper lands.
const enc = new Tiktoken(cl100kBase);
const tokens = (s: string) => enc.encode(s).length;

const BLOCK_A_BUDGET = 800;

describe("Block A — platform rules", () => {
  it("stays under the token budget", () => {
    const t = tokens(BLOCK_A_TEXT);
    expect(t).toBeLessThanOrEqual(BLOCK_A_BUDGET);
  });

  it("contains the load-bearing rules in plain text", () => {
    expect(BLOCK_A_TEXT).toMatch(/GROUNDING/);
    expect(BLOCK_A_TEXT).toMatch(/citations_used/);
    // Mirror rule must be there verbatim — it's the Gate-1 §4 fix.
    expect(BLOCK_A_TEXT).toMatch(/Mirror the customer's register/);
    expect(BLOCK_A_TEXT).toMatch(/Do NOT introduce religious/);
    // Darija script-mirroring rule with both scripts shown.
    expect(BLOCK_A_TEXT).toMatch(/Arabizi/);
    expect(BLOCK_A_TEXT).toMatch(/wach 3andkom/);
    expect(BLOCK_A_TEXT).toMatch(/واش عندكم/);
    // All five escalation enum values appear.
    for (const reason of [
      "EXPLICIT_REQUEST",
      "NEGATIVE_SENTIMENT",
      "PAYMENT_DISPUTE",
      "OUTSIDE_SCOPE",
      "LOW_CONFIDENCE",
    ]) {
      expect(BLOCK_A_TEXT).toContain(reason);
    }
    // Tool-call output contract (P4r-3: split into reply-as-content +
    // send_reply_metadata tool — Gate-1 E option a).
    expect(BLOCK_A_TEXT).toMatch(/send_reply_metadata/);
    expect(BLOCK_A_TEXT).toMatch(/natural response content/);
  });

  it("does NOT contain rules that were removed in Gate 1", () => {
    // Phase 8 owns multi-turn replay; Block A must not pretend to.
    expect(BLOCK_A_TEXT).not.toMatch(/replied 3\+? times/i);
    expect(BLOCK_A_TEXT).not.toMatch(/3\+ replies/i);
    // Confidence threshold lives in the orchestrator, not the prompt.
    expect(BLOCK_A_TEXT).not.toMatch(/confidence\s*<\s*0\.6/i);
    // The "inshallah is fine" guidance was struck from FRENCH per §4.
    // We allow the word in the don't-introduce list, but not as encouragement.
    expect(BLOCK_A_TEXT).not.toMatch(/inshallah.*(fine|ok|natural|mirror)/i);
  });
});

describe("buildBlockA / buildBlockB / buildBlockC", () => {
  it("buildBlockA returns the text block", () => {
    const b = buildBlockA();
    expect(b.type).toBe("text");
    expect(b.text).toBe(BLOCK_A_TEXT);
  });

  it("buildBlockB renders tenant identity and voice profile", () => {
    const voice = defaultVoiceProfile();
    voice.signaturePhrases = ["Always glad to help"];
    voice.avoid = ["competitor X"];
    voice.fewShot = [{ customer: "Hi", reply: "Hello — how can I help?" }];
    const b = buildBlockB({ tenantName: "Acme Co.", voice });
    expect(b.type).toBe("text");
    expect(b.text).toContain("Business name: Acme Co.");
    expect(b.text).toContain("Default language: fr");
    expect(b.text).toContain("Tone: friendly");
    expect(b.text).toContain("Formality: 3");
    expect(b.text).toContain("Always glad to help");
    expect(b.text).toContain("competitor X");
    expect(b.text).toContain("Customer: Hi");
    expect(b.text).toContain("You:      Hello — how can I help?");
  });

  it("buildBlockB handles empty signature phrases / avoid / fewShot gracefully", () => {
    const voice = defaultVoiceProfile();
    const b = buildBlockB({ tenantName: "Solo Co.", voice });
    expect(b.text).toContain("Signature phrases: (none)");
    expect(b.text).toContain("Avoid: (no explicit constraints)");
    expect(b.text).not.toContain("FEW-SHOT EXAMPLES");
  });

  it("buildBlockB renders tier-1 operational facts when supplied (Phase 8b)", () => {
    const voice = defaultVoiceProfile();
    const b = buildBlockB({
      tenantName: "Acme Co.",
      voice,
      operationalFactsTier1: {
        displayName: "Acme Distribution",
        primaryLanguage: "ar",
        primaryContact: {
          name: "Ops Desk",
          email: "ops@acme.test",
          phone: "+213 555 12 34 56",
        },
        languagesServed: ["fr", "ar", "darija"],
      },
    });
    // displayName takes precedence over tenantName.
    expect(b.text).toContain("Business name: Acme Distribution");
    // Operator-set primary language appears (differs from voice default "fr").
    expect(b.text).toContain("Primary language (operator-set): ar");
    expect(b.text).toContain("Languages served: fr, ar, darija");
    expect(b.text).toContain(
      "Primary contact (for human handoff): Ops Desk · ops@acme.test · +213 555 12 34 56",
    );
  });

  it("buildBlockB falls back to tenantName when displayName is missing", () => {
    const voice = defaultVoiceProfile();
    const b = buildBlockB({
      tenantName: "Acme Co.",
      voice,
      operationalFactsTier1: { primaryLanguage: "fr" },
    });
    expect(b.text).toContain("Business name: Acme Co.");
  });

  it("buildBlockB skips primary-language line when it matches voice.defaultLanguage", () => {
    const voice = defaultVoiceProfile(); // defaultLanguage = "fr"
    const b = buildBlockB({
      tenantName: "Acme",
      voice,
      operationalFactsTier1: { primaryLanguage: "fr" },
    });
    expect(b.text).toContain("Default language: fr");
    expect(b.text).not.toContain("Primary language (operator-set)");
  });

  it("buildBlockB renders only contact bits that are present", () => {
    const voice = defaultVoiceProfile();
    const b = buildBlockB({
      tenantName: "Acme",
      voice,
      operationalFactsTier1: {
        primaryContact: { email: "only-email@acme.test" },
      },
    });
    expect(b.text).toContain("Primary contact (for human handoff): only-email@acme.test");
    // No stray separators when name / phone are absent.
    expect(b.text).not.toContain("· · ");
  });

  it("buildBlockB omits the primary-contact line entirely when contact is empty", () => {
    const voice = defaultVoiceProfile();
    const b = buildBlockB({
      tenantName: "Acme",
      voice,
      operationalFactsTier1: { primaryContact: {} },
    });
    expect(b.text).not.toContain("Primary contact");
  });

  it("buildBlockC renders chunk citations with kind tag", () => {
    const c = buildBlockC({
      citations: [
        {
          kind: "chunk",
          sourceName: "docs.example.com",
          sourceUrl: "https://docs.example.com/shipping",
          content: "Shipping costs 50 DZD across Algeria.",
        },
      ],
      history: [
        { role: "customer", text: "Hello" },
        { role: "you", text: "Hi! How can I help?" },
      ],
      message: "What are your shipping costs?",
    });
    expect(c).toContain(
      "[1] CITATION — docs.example.com — https://docs.example.com/shipping",
    );
    expect(c).toContain("Shipping costs 50 DZD");
    expect(c).toContain("[customer] Hello");
    expect(c).toContain("[you]      Hi!");
    expect(c).toContain("NEW CUSTOMER MESSAGE\nWhat are your shipping costs?");
    expect(c).toMatch(/Reply now:.*send_reply_metadata\.$/);
  });

  it("buildBlockC renders structured-item citations with the items kind tag", () => {
    const c = buildBlockC({
      citations: [
        {
          kind: "item",
          name: "Macbook Pro M3",
          brand: "Apple",
          sku: "MBP-M3-14",
          currency: "USD",
          priceCents: 220_000,
          availability: "IN_STOCK",
          specs: { color: "space gray", ram: "16GB", _template_id: "laptop" },
        },
      ],
      history: [],
      message: "Do you have Macbooks?",
    });
    expect(c).toContain("[1] STRUCTURED ITEM — Macbook Pro M3 (Apple)");
    expect(c).toContain("SKU: MBP-M3-14");
    expect(c).toContain("Price: USD 2200.00");
    expect(c).toContain("Availability: IN_STOCK");
    expect(c).toContain("color: space gray");
    expect(c).toContain("ram: 16GB");
    // Reserved _-prefix keys must NOT leak into the prompt.
    expect(c).not.toContain("_template_id");
    expect(c).not.toContain("laptop");
  });

  it("buildBlockC renders Q&A citations with the USE NEAR-VERBATIM tag", () => {
    const c = buildBlockC({
      citations: [
        {
          kind: "qna",
          question: "What are your shipping times?",
          answer: "We ship in 2-3 business days within Algeria.",
        },
      ],
      history: [],
      message: "shipping?",
    });
    expect(c).toContain("[1] Q&A (USE NEAR-VERBATIM)");
    expect(c).toContain("Q: What are your shipping times?");
    expect(c).toContain("A: We ship in 2-3 business days");
  });

  it("buildBlockC renders operational-fact citations per field", () => {
    const c = buildBlockC({
      citations: [
        {
          kind: "operational_fact",
          field: "hours",
          value: {
            tz: "Africa/Algiers",
            weekly: [
              { day: "mon", open: "09:00", close: "17:00" },
              { day: "fri", open: "09:00", close: "13:00" },
            ],
          },
        },
        {
          kind: "operational_fact",
          field: "locations",
          value: [{ label: "HQ", address: "Algiers Centre" }],
        },
      ],
      history: [],
      message: "where are you?",
    });
    expect(c).toContain("[1] OPERATIONAL FACT — hours");
    expect(c).toContain("Mon 09:00-17:00");
    expect(c).toContain("Fri 09:00-13:00");
    expect(c).toContain("Africa/Algiers");
    expect(c).toContain("[2] OPERATIONAL FACT — locations");
    expect(c).toContain("HQ — Algiers Centre");
  });

  it("buildBlockC numbers citations sequentially across kinds", () => {
    const c = buildBlockC({
      citations: [
        { kind: "item", name: "Item A", brand: null, sku: null, currency: null, priceCents: null, availability: "UNKNOWN" },
        { kind: "chunk", sourceName: "doc.com", content: "content" },
        { kind: "qna", question: "Q", answer: "A" },
      ],
      history: [],
      message: "?",
    });
    expect(c).toContain("[1] STRUCTURED ITEM");
    expect(c).toContain("[2] CITATION");
    expect(c).toContain("[3] Q&A");
  });

  it("buildBlockC tells the model when there are no citations", () => {
    const c = buildBlockC({ citations: [], history: [], message: "hi" });
    expect(c).toContain("(none — knowledge base did not return any relevant chunks)");
    expect(c).toContain("(this is the first message)");
  });

  it("buildBlockC truncates very long chunk citations to keep input bounded", () => {
    const long = "x".repeat(10_000);
    const c = buildBlockC({
      citations: [{ kind: "chunk", sourceName: "huge", content: long }],
      history: [],
      message: "?",
    });
    // Each chunk citation content capped to ~1200 chars (MAX_CHUNK_CONTENT_CHARS).
    expect(c.length).toBeLessThan(2_000);
  });
});

describe("Block A+B+C token budget (Phase 8c)", () => {
  // Per Gate-1 P8c risk discussion: assert that a representative envelope
  // (full tier-1 facts, top-5 items, top-5 chunks, 1 Q&A, tier-2 hours +
  // locations) fits ≤ 5500 tokens. That leaves 2500 tokens of the 8000-
  // token input headroom for history + new message + output buffer.
  //
  // If this breaks, the offender is usually one of:
  //   - Block A grew (token budget asserted ≤ 800 separately).
  //   - Block B grew (operator added too many few-shot examples).
  //   - Per-section caps in Block C were loosened.
  //
  // Don't relax the budget — tighten the per-section caps instead.
  it("a representative full-envelope prompt fits in 5500 tokens", () => {
    const voice = defaultVoiceProfile();
    voice.signaturePhrases = ["Always glad to help"];
    voice.fewShot = [
      { customer: "Hi, what are your hours?", reply: "We're open 9-5." },
      { customer: "Do you ship?", reply: "Yes, 2-3 days nationwide." },
    ];
    const result = buildPrompt({
      tenantName: "Acme Distribution",
      voice,
      operationalFactsTier1: {
        displayName: "Acme Distribution",
        primaryLanguage: "fr",
        primaryContact: { email: "ops@acme.test", name: "Ops Desk", phone: "+213 555 12 34 56" },
        languagesServed: ["fr", "ar", "en", "darija"],
      },
      citations: [
        // Top-5 items
        ...Array.from({ length: 5 }, (_, i) => ({
          kind: "item" as const,
          name: `Product ${i + 1} with a moderately long name`,
          brand: "BrandX",
          sku: `SKU-${i + 1}`,
          currency: "DZD",
          priceCents: 150_000 + i * 1000,
          availability: "IN_STOCK" as const,
          specs: { color: "red", size: "L" },
        })),
        // Top-5 chunks (matches TOP_K_CHUNKS_WITH_ITEMS when items present)
        ...Array.from({ length: 5 }, (_, i) => ({
          kind: "chunk" as const,
          sourceName: `docs.example.com/page-${i + 1}`,
          sourceUrl: `https://docs.example.com/page-${i + 1}`,
          // Realistic chunk content — typical length after the 1200-char
          // truncation in renderCitation.
          content:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
            "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(
              5,
            ),
        })),
        // 1 Q&A authoritative match
        {
          kind: "qna" as const,
          question: "What are your shipping times?",
          answer:
            "We ship orders within 2-3 business days inside Algeria. International orders take 5-7 days. Cash on delivery is available nationwide.",
        },
        // Tier-2 facts: hours + locations (typical relevance)
        {
          kind: "operational_fact" as const,
          field: "hours" as const,
          value: {
            tz: "Africa/Algiers",
            weekly: [
              { day: "mon", open: "09:00", close: "17:00" },
              { day: "tue", open: "09:00", close: "17:00" },
              { day: "wed", open: "09:00", close: "17:00" },
              { day: "thu", open: "09:00", close: "17:00" },
              { day: "fri", open: "09:00", close: "13:00" },
            ] as { day: "mon" | "tue" | "wed" | "thu" | "fri"; open: string; close: string }[],
          },
        },
        {
          kind: "operational_fact" as const,
          field: "locations" as const,
          value: [
            { label: "HQ", address: "Algiers Centre" },
            { label: "Branch Oran", address: "Oran City Center" },
          ],
        },
      ],
      history: [],
      message: "Quels sont vos horaires?",
    });
    const total =
      tokens(result.system[0]!.text) +
      tokens(result.system[1]!.text) +
      tokens(result.userMessage);
    expect(total).toBeLessThanOrEqual(5500);
  });
});

describe("buildPrompt", () => {
  it("returns Block A + Block B as system blocks and Block C as user message", () => {
    const voice = defaultVoiceProfile();
    const result = buildPrompt({
      tenantName: "Acme",
      voice,
      citations: [],
      history: [],
      message: "test",
    });
    expect(result.system).toHaveLength(2);
    expect(result.system[0]!.text).toBe(BLOCK_A_TEXT);
    expect(result.system[1]!.text).toContain("Business name: Acme");
    expect(result.userMessage).toContain("NEW CUSTOMER MESSAGE\ntest");
  });
});
