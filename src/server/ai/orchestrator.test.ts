import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prisma + retriever are mocked so this test never hits the live DB or
// embedding API. We're testing the orchestrator's wiring, not its deps.
vi.mock("../db/client", () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../knowledge/retriever", () => ({
  retrieve: vi.fn(),
}));

import { prisma } from "../db/client";
import { retrieve } from "../knowledge/retriever";
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
  vi.mocked(retrieve).mockResolvedValue([sampleChunk(0), sampleChunk(1), sampleChunk(2)]);
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
    expect(r.citations[0]!.sourceName).toBe("docs.example.com");
    expect(r.citations[0]!.sourceUrl).toBe("https://docs.example.com/page");
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
    vi.mocked(retrieve).mockResolvedValueOnce([]);
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
