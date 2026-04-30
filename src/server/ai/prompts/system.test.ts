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
    // Tool-call output contract.
    expect(BLOCK_A_TEXT).toMatch(/send_reply tool/);
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

  it("buildBlockC renders citations + history + new message", () => {
    const c = buildBlockC({
      citations: [
        {
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
    expect(c).toContain("[1] docs.example.com — https://docs.example.com/shipping");
    expect(c).toContain("Shipping costs 50 DZD");
    expect(c).toContain("[customer] Hello");
    expect(c).toContain("[you]      Hi!");
    expect(c).toContain("NEW CUSTOMER MESSAGE\nWhat are your shipping costs?");
    expect(c).toMatch(/Reply now via send_reply\.$/);
  });

  it("buildBlockC tells the model when there are no citations", () => {
    const c = buildBlockC({ citations: [], history: [], message: "hi" });
    expect(c).toContain("(none — knowledge base did not return any relevant chunks)");
    expect(c).toContain("(this is the first message)");
  });

  it("buildBlockC truncates very long citations to keep input bounded", () => {
    const long = "x".repeat(10_000);
    const c = buildBlockC({
      citations: [{ sourceName: "huge", content: long }],
      history: [],
      message: "?",
    });
    // Each citation capped to ~1200 chars so the prompt total stays ≤6000 tokens.
    expect(c.length).toBeLessThan(2_000);
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
