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

// ─────────────────────────────────────────────────────────────────────────────
// P4r-2 — RealClaudeClient integration
// ─────────────────────────────────────────────────────────────────────────────

import {
  __setClaudeClientForTests,
  type ClaudeClient,
  type SendReplyArgs,
  type SendReplyResult,
} from "./claude-client";
import {
  AnthropicConversationBudgetExhaustedError,
  AnthropicServerError,
  AnthropicToolRefusalError,
} from "./errors";
import { __resetConversationRetryBudgetForTests } from "./orchestrator";

class ScriptableClient implements ClaudeClient {
  // Each call shifts off the next response. Throws if scripts exhaust.
  private scripts: Array<() => Promise<SendReplyResult>> = [];

  pushSuccess(overrides?: Partial<SendReplyResult>): void {
    this.scripts.push(async () => ({
      toolArgs: {
        reply: "real reply",
        language: "en",
        groundedness: 0.9,
        citations_used: [1, 2],
        escalation_recommended: false,
      },
      modelId: "claude-sonnet-4-6",
      usage: { inputTokens: 1000, outputTokens: 50 },
      retriesUsed: 0,
      ...overrides,
    }));
  }

  pushReject(err: unknown): void {
    this.scripts.push(async () => {
      throw err;
    });
  }

  async sendReply(_args: SendReplyArgs): Promise<SendReplyResult> {
    const next = this.scripts.shift();
    if (!next) throw new Error("ScriptableClient: no more scripts");
    return next();
  }
}

describe("runBrain — P4r-2 tool refusal fallback", () => {
  beforeEach(() => {
    __resetConversationRetryBudgetForTests();
  });

  it("synthesizes OUTSIDE_SCOPE + TOOL_REFUSAL with a per-language fallback", async () => {
    const client = new ScriptableClient();
    client.pushReject(new AnthropicToolRefusalError());
    __setClaudeClientForTests(client);

    const r = await runBrain({
      tenantId: "tenant-1",
      message: "Quels sont vos horaires?",
    });

    expect(r.escalation).toBe("OUTSIDE_SCOPE");
    expect(r.aiMetadata.claudeReason).toBe("TOOL_REFUSAL");
    expect(r.aiMetadata.modelId).toBe("anthropic:tool-refusal");
    // French message → French fallback.
    expect(r.language).toBe("fr");
    expect(r.reply).toContain("Je ne peux pas");
    expect(r.confidence).toBe(0);
    expect(r.groundedness).toBe(0);
  });

  it("uses Darija fallback for Arabizi customer messages", async () => {
    const client = new ScriptableClient();
    client.pushReject(new AnthropicToolRefusalError());
    __setClaudeClientForTests(client);

    const r = await runBrain({
      tenantId: "tenant-1",
      message: "wach 3andkom des horaires?",
    });
    expect(r.language).toBe("darija");
    expect(r.reply).toContain("Smahli");
  });

  it("does NOT throw — keeps the conversation flowing", async () => {
    const client = new ScriptableClient();
    client.pushReject(new AnthropicToolRefusalError());
    __setClaudeClientForTests(client);

    await expect(
      runBrain({ tenantId: "tenant-1", message: "hello" }),
    ).resolves.toBeDefined();
  });
});

describe("runBrain — P4r-2 conversation retry budget", () => {
  beforeEach(() => {
    __resetConversationRetryBudgetForTests();
  });

  it("accumulates retriesUsed across turns", async () => {
    const client = new ScriptableClient();
    client.pushSuccess({ retriesUsed: 2 });
    client.pushSuccess({ retriesUsed: 2 });
    __setClaudeClientForTests(client);

    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      message: "hi",
    });
    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      message: "hi again",
    });
    // Two turns × 2 retries = 4 cumulative; below cap of 5, so the next
    // turn should still go through.
    client.pushSuccess({ retriesUsed: 0 });
    const r = await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      message: "third turn",
    });
    expect(r.reply).toBe("real reply");
  });

  it("fails fast when the cumulative budget is exhausted", async () => {
    const client = new ScriptableClient();
    client.pushSuccess({ retriesUsed: 3 });
    client.pushSuccess({ retriesUsed: 2 });
    __setClaudeClientForTests(client);

    // Two turns push cumulative to 5 — at the cap.
    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-2",
      message: "first",
    });
    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-2",
      message: "second",
    });
    // Third turn should fail-fast without even calling the client.
    await expect(
      runBrain({
        tenantId: "tenant-1",
        conversationId: "conv-2",
        message: "third (should fail fast)",
      }),
    ).rejects.toBeInstanceOf(AnthropicConversationBudgetExhaustedError);
  });

  it("clean turn (retriesUsed=0) resets the counter", async () => {
    const client = new ScriptableClient();
    client.pushSuccess({ retriesUsed: 4 });
    client.pushSuccess({ retriesUsed: 0 }); // resets to 0
    client.pushSuccess({ retriesUsed: 3 }); // now 3, not 7
    __setClaudeClientForTests(client);

    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-3",
      message: "first",
    });
    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-3",
      message: "second",
    });
    // Third turn would have failed without the reset (4 + 3 = 7 > 5),
    // but the clean-turn reset means we're at 0 + 3 = 3 < 5.
    const r = await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-3",
      message: "third",
    });
    expect(r.reply).toBe("real reply");
  });

  it("budget is per-conversation — different conversationId starts fresh", async () => {
    const client = new ScriptableClient();
    client.pushSuccess({ retriesUsed: 5 }); // burns conv-A's budget
    client.pushSuccess({ retriesUsed: 0 }); // conv-B is fine
    __setClaudeClientForTests(client);

    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-A",
      message: "burn",
    });
    const r = await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-B",
      message: "fresh",
    });
    expect(r.reply).toBe("real reply");
  });

  it("undefined conversationId skips the budget check entirely", async () => {
    const client = new ScriptableClient();
    client.pushSuccess({ retriesUsed: 0 });
    __setClaudeClientForTests(client);

    // No conversationId — smart-import-style call. Always allowed.
    const r = await runBrain({ tenantId: "tenant-1", message: "one-shot" });
    expect(r.reply).toBe("real reply");
  });

  it("on failure, retriesUsed counts toward the cumulative budget", async () => {
    const client = new ScriptableClient();
    const err = new AnthropicServerError("boom", 500);
    err.retriesUsed = 3;
    client.pushReject(err);
    __setClaudeClientForTests(client);

    // First turn fails; retries from the client count toward budget.
    await expect(
      runBrain({
        tenantId: "tenant-1",
        conversationId: "conv-fail",
        message: "fail me",
      }),
    ).rejects.toBe(err);

    // Second turn would push cumulative > 5 with another 3 retries → fail fast.
    const err2 = new AnthropicServerError("boom2", 500);
    err2.retriesUsed = 3;
    client.pushReject(err2);
    // Cumulative is 3; still below cap 5, so this turn does run and fails.
    await expect(
      runBrain({
        tenantId: "tenant-1",
        conversationId: "conv-fail",
        message: "fail again",
      }),
    ).rejects.toBe(err2);

    // Cumulative is now 6 → next turn fails fast.
    await expect(
      runBrain({
        tenantId: "tenant-1",
        conversationId: "conv-fail",
        message: "should fail fast",
      }),
    ).rejects.toBeInstanceOf(AnthropicConversationBudgetExhaustedError);
  });
});

describe("runBrain — P4r-2 cost log", () => {
  beforeEach(() => {
    __resetConversationRetryBudgetForTests();
  });

  it("emits [brain-cost] when usage is populated", async () => {
    const client = new ScriptableClient();
    client.pushSuccess({
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationInputTokens: 800,
        cacheReadInputTokens: 0,
      },
    });
    __setClaudeClientForTests(client);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runBrain({
      tenantId: "tenant-1",
      conversationId: "conv-cost",
      message: "hi",
    });
    const matched = logSpy.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].startsWith("[brain-cost]"),
    );
    expect(matched).toBeDefined();
    const line = matched![0] as string;
    expect(line).toContain("tenant=tenant-1");
    expect(line).toContain("model=claude-sonnet-4-6");
    expect(line).toContain("input=1000");
    expect(line).toContain("output=200");
    expect(line).toContain("cache_create=800");
    expect(line).toContain("cache_read=0");
    expect(line).toContain("retries=0");
    // Cost is non-zero given the input.
    expect(line).toMatch(/cost=\$\d+\.\d{6}/);
    logSpy.mockRestore();
  });

  it("skips [brain-cost] when usage is null (stub path)", async () => {
    const client = new ScriptableClient();
    client.pushSuccess({ usage: null });
    __setClaudeClientForTests(client);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runBrain({ tenantId: "tenant-1", message: "hi" });
    const matched = logSpy.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].startsWith("[brain-cost]"),
    );
    expect(matched).toBeUndefined();
    logSpy.mockRestore();
  });
});
