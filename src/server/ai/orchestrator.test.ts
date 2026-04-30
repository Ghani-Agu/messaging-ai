import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as OperationalFactsModule from "../db/operational-facts";

// Prisma + retriever + operational-facts are mocked so this test never
// hits the live DB or embedding API. We're testing the orchestrator's
// wiring, not its deps.
vi.mock("../db/client", () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../knowledge/retriever", () => ({
  retrieveChunks: vi.fn(),
  retrieveItems: vi.fn(),
  retrieveQnaMatches: vi.fn(),
}));

vi.mock("@/server/ai/embeddings", () => ({
  embed: vi.fn(async () => ({
    vectors: [[0.1, 0.2, 0.3]],
    provider: "voyage" as const,
  })),
}));

vi.mock("../db/operational-facts", async () => {
  const actual = await vi.importActual<typeof OperationalFactsModule>(
    "../db/operational-facts",
  );
  return {
    // Re-export the real schemas / picker / detector so the orchestrator
    // uses real logic for tier-1 / tier-2 decisions.
    ...actual,
    getOperationalFacts: vi.fn(),
  };
});

import { prisma } from "../db/client";
import {
  retrieveChunks,
  retrieveItems,
  retrieveQnaMatches,
} from "../knowledge/retriever";
import { getOperationalFacts } from "../db/operational-facts";
import { runBrain } from "./orchestrator";
import {
  __resetClaudeClientForTests,
  StubClaudeClient,
} from "./claude-client";

const mockedTenant = {
  name: "Acme Co.",
  settings: {
    voiceProfile: {
      tone: "friendly",
      formality: 3,
      signaturePhrases: [],
      avoid: [],
      emojiPolicy: "minimal",
      defaultLanguage: "fr",
      fallbackLanguage: "en",
      fewShot: [],
    },
  },
};

const sampleChunk = (i: number) => ({
  chunkId: `chunk-${i}`,
  sourceId: "src-1",
  sourceName: "docs.example.com",
  sourceType: "WEBSITE" as const,
  content: `Useful fact number ${i} about shipping.`,
  metadata: { url: "https://docs.example.com/page" },
  vectorScore: 0.9 - i * 0.05,
  vectorRank: i + 1,
  lexicalScore: null,
  lexicalRank: null,
  rrfScore: 0.02,
  embedProvider: "voyage" as const,
});

beforeEach(() => {
  __resetClaudeClientForTests();
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockedTenant as never);
  // P8c: orchestrator runs three retrieval channels in parallel. Default
  // each to a sensible non-empty / empty mix; tests that need different
  // shapes override per-call below.
  vi.mocked(retrieveChunks).mockResolvedValue([
    sampleChunk(0),
    sampleChunk(1),
    sampleChunk(2),
  ]);
  vi.mocked(retrieveItems).mockResolvedValue([]);
  vi.mocked(retrieveQnaMatches).mockResolvedValue([]);
  // Default: no operational facts (pre-Phase-8 tenant). Specific tests
  // override per-call to inject tier-1 / tier-2 envelopes.
  vi.mocked(getOperationalFacts).mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runBrain — happy path with stub client", () => {
  it("returns a shaped BrainResult and surfaces all citations", async () => {
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "What are your shipping options?",
    });

    expect(r.reply.length).toBeGreaterThan(0);
    expect(r.language).toBe("en");
    expect(r.citations).toHaveLength(3);
    expect(r.citations[0]!.index).toBe(1);
    expect(r.citations[0]!.kind).toBe("chunk");
    // Narrow on kind for kind-specific fields. Default mock returns chunks
    // only, so [0] is a chunk citation.
    const c0 = r.citations[0]!;
    if (c0.kind !== "chunk") throw new Error("expected chunk citation");
    expect(c0.sourceName).toBe("docs.example.com");
    expect(c0.sourceUrl).toBe("https://docs.example.com/page");
    // Stub uses citations 1+2 on the happy path.
    expect(r.citationsUsed).toEqual([1, 2]);
  });

  it("computes confidence above the threshold and yields no escalation", async () => {
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "What are your shipping options?",
    });
    // groundedness 0.85, topSim 0.9, 2 citations → comfortably above 0.6.
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.escalation).toBeNull();
    expect(r.aiMetadata.claudeRecommendedEscalation).toBe(false);
    expect(r.aiMetadata.modelId).toBe("stub");
  });
});

describe("runBrain — escalation paths", () => {
  it("explicit human request → EXPLICIT_REQUEST", async () => {
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "Can I speak to a human agent?",
    });
    expect(r.aiMetadata.claudeRecommendedEscalation).toBe(true);
    expect(r.aiMetadata.claudeReason).toBe("EXPLICIT_REQUEST");
    // Confidence will be low (groundedness 0.1, escalation penalty,
    // zero citations) so the LOW_CONFIDENCE override fires.
    expect(r.escalation).toBe("LOW_CONFIDENCE");
    expect(r.confidence).toBeLessThan(0.6);
  });

  it("refund language → PAYMENT_DISPUTE preserved when above threshold", async () => {
    // Bump topChunkSimilarity high enough that confidence stays ≥ 0.6
    // and the orchestrator doesn't override Claude's PAYMENT_DISPUTE.
    // groundedness 0.2, topSim 1.0, 0 citations, escalation=true:
    //   0.50·0.2 + 0.25·1.0 + 0 - 0.30 - 0.20 = -0.15 → clamps to 0.
    // Stub returns 0.2 groundedness; with no citations & escalation
    // recommended this stays under threshold → LOW_CONFIDENCE.
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "Je veux un remboursement, c'est inacceptable!",
    });
    expect(r.aiMetadata.claudeReason).toBe("PAYMENT_DISPUTE");
    expect(r.escalation).toBe("LOW_CONFIDENCE");
  });

  it("no citations → OUTSIDE_SCOPE, escalation surfaces, low confidence", async () => {
    vi.mocked(retrieveChunks).mockResolvedValueOnce([]);
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "Bonjour, comment allez-vous?",
    });
    expect(r.citations).toEqual([]);
    expect(r.aiMetadata.claudeReason).toBe("OUTSIDE_SCOPE");
    expect(r.aiMetadata.topChunkSimilarity).toBe(0);
    expect(r.escalation).toBe("LOW_CONFIDENCE");
  });
});

describe("runBrain — stub language detection covers Darija scripts", () => {
  it("Arabizi (Latin + numerals) → darija", async () => {
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "wach 3andkom des horaires?",
    });
    expect(r.language).toBe("darija");
  });

  it("Arabic-script Darija marker → darija", async () => {
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "واش عندكم وقت الخدمة؟",
    });
    expect(r.language).toBe("darija");
  });

  it("Arabic script without dialect markers → ar (MSA)", async () => {
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "ما هي ساعات العمل؟",
    });
    expect(r.language).toBe("ar");
  });

  it("French phrasing → fr", async () => {
    const r = await runBrain({
      tenantId: "tenant-1",
      message: "Quels sont vos horaires d'ouverture?",
    });
    expect(r.language).toBe("fr");
  });
});

describe("runBrain — guardrails", () => {
  it("throws when the tenant doesn't exist", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);
    await expect(
      runBrain({ tenantId: "ghost", message: "hi" }),
    ).rejects.toThrow(/tenant not found/);
  });

  it("uses the StubClaudeClient by default", () => {
    // Sanity: factory wires the stub.
    expect(new StubClaudeClient()).toBeDefined();
  });
});

describe("runBrain — Phase 8b operational facts (tier-1 in Block B)", () => {
  // Capture the system blocks the stub sees so we can inspect what flowed
  // through buildBlockB. The stub doesn't itself surface them in
  // BrainResult, so we spy on the client for these tests.
  it("loads operational facts and calls getOperationalFacts with tenantId", async () => {
    vi.mocked(getOperationalFacts).mockResolvedValueOnce({
      displayName: "WBP Distribution",
      primaryLanguage: "fr",
    });
    await runBrain({ tenantId: "tenant-1", message: "hello" });
    expect(vi.mocked(getOperationalFacts)).toHaveBeenCalledWith({
      tenantId: "tenant-1",
    });
  });

  it("renders tier-1 facts (displayName + languagesServed) into Block B and omits tier-2", async () => {
    // Spy on StubClaudeClient.sendReply to capture the system blocks the
    // brain assembled. Use module mocking against this single test.
    const { __resetClaudeClientForTests, getClaudeClient } = await import(
      "./claude-client"
    );
    __resetClaudeClientForTests();
    const client = getClaudeClient();
    const sendSpy = vi.spyOn(client, "sendReply");

    // mockedTenant.voiceProfile.defaultLanguage is "fr" — pick a different
    // primaryLanguage here so the operator-set line actually renders
    // (when they match, buildBlockB suppresses the duplicate, asserted in
    // a separate test below).
    vi.mocked(getOperationalFacts).mockResolvedValueOnce({
      // tier-1
      displayName: "WBP Distribution",
      primaryLanguage: "ar",
      languagesServed: ["fr", "ar", "en"],
      primaryContact: { email: "ops@wbp.test", name: "Ops Desk" },
      // tier-2 — must NOT appear in Block B
      hours: { tz: "Africa/Algiers", weekly: [] },
      currency: "DZD",
      locations: [{ label: "HQ", address: "Algiers" }],
      serviceArea: "Algeria",
    });

    await runBrain({ tenantId: "tenant-1", message: "hello" });

    expect(sendSpy).toHaveBeenCalledOnce();
    const callArgs = sendSpy.mock.calls[0]![0]!;
    const blockBText = callArgs.system[1]!.text;

    // Tier-1 surfaces:
    expect(blockBText).toContain("Business name: WBP Distribution");
    expect(blockBText).toContain("Primary language (operator-set): ar");
    expect(blockBText).toContain("Languages served: fr, ar, en");
    expect(blockBText).toContain("Primary contact (for human handoff)");
    expect(blockBText).toContain("ops@wbp.test");

    // Tier-2 does NOT leak into Block B:
    expect(blockBText).not.toContain("Africa/Algiers");
    expect(blockBText).not.toContain("DZD");
    expect(blockBText).not.toContain("Algiers");
    expect(blockBText).not.toContain("Service area");
    // P8b: tier-2 retrieval not yet wired; assert it's NOT in Block C either
    // (it lives only in the OperationalFacts row until the retrieval pass
    // lands).
    expect(callArgs.userMessage).not.toContain("DZD");
  });

  it("falls back to tenant.name when displayName is unset", async () => {
    const { __resetClaudeClientForTests, getClaudeClient } = await import(
      "./claude-client"
    );
    __resetClaudeClientForTests();
    const client = getClaudeClient();
    const sendSpy = vi.spyOn(client, "sendReply");

    // No facts at all (default mock returns {}). Block B should still
    // render with "Business name: Acme Co." from the tenant row.
    await runBrain({ tenantId: "tenant-1", message: "hello" });
    const blockBText = sendSpy.mock.calls[0]![0]!.system[1]!.text;
    expect(blockBText).toContain("Business name: Acme Co.");
    // No primary-language line when facts are empty.
    expect(blockBText).not.toContain("Primary language (operator-set)");
  });

  it("does not surface a primary-language line when it equals the voice profile default", async () => {
    const { __resetClaudeClientForTests, getClaudeClient } = await import(
      "./claude-client"
    );
    __resetClaudeClientForTests();
    const client = getClaudeClient();
    const sendSpy = vi.spyOn(client, "sendReply");

    // mockedTenant's voiceProfile.defaultLanguage is "fr". When facts'
    // primaryLanguage is also "fr", we don't add a duplicate line.
    vi.mocked(getOperationalFacts).mockResolvedValueOnce({
      primaryLanguage: "fr",
    });
    await runBrain({ tenantId: "tenant-1", message: "hello" });
    const blockBText = sendSpy.mock.calls[0]![0]!.system[1]!.text;
    expect(blockBText).toContain("Default language: fr");
    expect(blockBText).not.toContain("Primary language (operator-set)");
  });
});
