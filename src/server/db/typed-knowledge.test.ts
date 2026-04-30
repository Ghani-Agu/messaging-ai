import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma so these tests never hit the live DB. The helper-layer logic
// we care about (normalization, dedupe-error mapping, embed-text shape,
// tier-1 picker) lives in pure functions and in the catch path of CRUD —
// neither needs a real DB. Integration tests via Server Actions land in
// later commits.
vi.mock("./client", () => ({
  prisma: {
    qnaPair: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

// Phase 8c: db/items + db/qna now import enqueueEmbedItems /
// enqueueEmbedQna from queue/jobs. queue/jobs loads queue/queues which
// instantiates Queue() at module-load and throws if REDIS_URL is unset
// (which it isn't in test env). Mock the enqueue helpers to no-ops so the
// import graph never reaches Redis.
vi.mock("@/server/queue/jobs", () => ({
  enqueueEmbedItems: vi.fn(async () => {}),
  enqueueEmbedQna: vi.fn(async () => {}),
  enqueueEmbedKnowledgeGap: vi.fn(async () => {}),
}));

import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import {
  buildItemEmbedText,
} from "./items";
import {
  QnaDuplicateError,
  createQnaPair,
  normalizeQuestion,
  updateQnaPair,
} from "./qna";
import {
  TIER1_KEYS,
  parseOperationalFactsData,
  pickTier1,
} from "./operational-facts";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Q&A — normalization + dedupe error mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeQuestion", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeQuestion("  What  ARE   your  HOURS?  ")).toBe(
      "what are your hours?",
    );
  });
  it("collapses tabs and newlines into single spaces", () => {
    expect(normalizeQuestion("hello\n\tworld\n\n")).toBe("hello world");
  });
  it("returns empty string for whitespace-only input (caller validates)", () => {
    expect(normalizeQuestion("   \t\n  ")).toBe("");
  });
  it("preserves non-ASCII characters (Arabic / French) without case folding artifacts", () => {
    // Arabic doesn't have case; lower() is a no-op. French é → é.
    expect(normalizeQuestion("Quels sont vos HORAIRES?")).toBe(
      "quels sont vos horaires?",
    );
    expect(normalizeQuestion("ما هي ساعات العمل؟")).toBe("ما هي ساعات العمل؟");
  });
});

describe("createQnaPair — dedupe", () => {
  const tenantId = "t1";
  const input = {
    question: "What are your hours?",
    answer: "9–5 every day.",
    languageLock: false,
    tags: [],
  };

  it("on P2002 unique violation, throws QnaDuplicateError pointing at existing pair", async () => {
    // Prisma's create rejects with P2002 when the (tenantId,
    // normalizedQuestion) composite unique fires. The helper catches it,
    // looks up the existing row, and re-throws QnaDuplicateError.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["tenantId", "normalizedQuestion"] } },
    );
    vi.mocked(prisma.qnaPair.create).mockRejectedValueOnce(p2002);
    vi.mocked(prisma.qnaPair.findFirst).mockResolvedValueOnce({ id: "existing-pair-id" } as never);

    await expect(createQnaPair({ tenantId, input })).rejects.toBeInstanceOf(
      QnaDuplicateError,
    );

    // Re-run the same call to inspect the error fields rather than
    // relying on rejects.toBeInstanceOf alone.
    vi.mocked(prisma.qnaPair.create).mockRejectedValueOnce(p2002);
    vi.mocked(prisma.qnaPair.findFirst).mockResolvedValueOnce({ id: "existing-pair-id" } as never);
    try {
      await createQnaPair({ tenantId, input });
      expect.fail("expected QnaDuplicateError");
    } catch (err) {
      expect(err).toBeInstanceOf(QnaDuplicateError);
      const dup = err as QnaDuplicateError;
      expect(dup.existingPairId).toBe("existing-pair-id");
      expect(dup.normalizedQuestion).toBe("what are your hours?");
    }
  });

  it("non-P2002 errors propagate unchanged", async () => {
    const other = new Prisma.PrismaClientKnownRequestError(
      "FK violation",
      { code: "P2003", clientVersion: "test" },
    );
    vi.mocked(prisma.qnaPair.create).mockRejectedValueOnce(other);
    await expect(createQnaPair({ tenantId, input })).rejects.toBe(other);
    // The dedupe lookup should NOT have been called for non-P2002.
    expect(vi.mocked(prisma.qnaPair.findFirst)).not.toHaveBeenCalled();
  });

  it("happy path returns the new id without touching the dedupe lookup", async () => {
    vi.mocked(prisma.qnaPair.create).mockResolvedValueOnce({ id: "new-id" } as never);
    const r = await createQnaPair({ tenantId, input });
    expect(r.id).toBe("new-id");
    expect(vi.mocked(prisma.qnaPair.findFirst)).not.toHaveBeenCalled();
  });
});

describe("updateQnaPair — dedupe on edit", () => {
  const tenantId = "t1";
  const qnaId = "qna-being-edited";
  const input = {
    question: "What are your hours?",
    answer: "9–5.",
    languageLock: false,
    tags: [],
  };

  it("when the new question collides with another row, throws QnaDuplicateError pointing at the OTHER row", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" },
    );
    vi.mocked(prisma.qnaPair.updateMany).mockRejectedValueOnce(p2002);
    // findFirst is called with NOT: { id: qnaId } so the helper finds the
    // OTHER row (not the row being edited) — that's the one the operator
    // needs to be pointed to.
    vi.mocked(prisma.qnaPair.findFirst).mockResolvedValueOnce({
      id: "other-existing-pair",
    } as never);

    try {
      await updateQnaPair({ tenantId, qnaId, input });
      expect.fail("expected QnaDuplicateError");
    } catch (err) {
      expect(err).toBeInstanceOf(QnaDuplicateError);
      expect((err as QnaDuplicateError).existingPairId).toBe("other-existing-pair");
    }
    // Confirm the helper passed NOT: { id: qnaId } in the lookup.
    const findCall = vi.mocked(prisma.qnaPair.findFirst).mock.calls[0]![0]!;
    expect(findCall.where).toMatchObject({ NOT: { id: qnaId } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Items — embed text builder
// ─────────────────────────────────────────────────────────────────────────────

describe("buildItemEmbedText", () => {
  it("concatenates name / brand / sku / description with em-dashes", () => {
    const text = buildItemEmbedText({
      name: "Macbook Pro M3",
      brand: "Apple",
      sku: "MBP-M3-14",
      description: "14-inch laptop with M3 chip.",
    });
    expect(text).toBe("Macbook Pro M3 — Apple — MBP-M3-14 — 14-inch laptop with M3 chip.");
  });

  it("flattens spec key:value pairs and skips reserved keys (_template_id)", () => {
    const text = buildItemEmbedText({
      name: "Macbook Pro M3",
      brand: null,
      sku: null,
      description: null,
      specs: {
        _template_id: "laptop-template-v1",
        color: "space gray",
        ram: "16GB",
        storage: "512GB",
      },
    });
    expect(text).toContain("color: space gray");
    expect(text).toContain("ram: 16GB");
    expect(text).toContain("storage: 512GB");
    expect(text).not.toContain("_template_id");
    expect(text).not.toContain("laptop-template-v1");
  });

  it("skips null / empty / non-string spec values gracefully", () => {
    const text = buildItemEmbedText({
      name: "Item",
      specs: {
        ok: "yes",
        empty: "",
        whitespace: "   ",
        zero: 0, // numeric — should be included
        flag: true, // boolean — should be included
        nullish: null,
      },
    });
    expect(text).toContain("ok: yes");
    expect(text).toContain("zero: 0");
    expect(text).toContain("flag: true");
    expect(text).not.toContain("empty:");
    expect(text).not.toContain("whitespace:");
    expect(text).not.toContain("nullish:");
  });

  it("handles missing optional fields without leaving stray separators", () => {
    const text = buildItemEmbedText({ name: "Solo Item" });
    expect(text).toBe("Solo Item");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OperationalFacts — tier picker + tolerant parse
// ─────────────────────────────────────────────────────────────────────────────

describe("pickTier1", () => {
  it("returns only tier-1 fields, omitting tier-2 even when present", () => {
    const tier1 = pickTier1({
      displayName: "WBP Distribution",
      primaryLanguage: "fr",
      primaryContact: { email: "ops@wbp.test" },
      languagesServed: ["fr", "ar", "en"],
      // tier-2 — must be stripped
      hours: { tz: "Africa/Algiers", weekly: [] },
      currency: "DZD",
      locations: [{ label: "HQ", address: "Algiers" }],
    });
    expect(tier1).toEqual({
      displayName: "WBP Distribution",
      primaryLanguage: "fr",
      primaryContact: { email: "ops@wbp.test" },
      languagesServed: ["fr", "ar", "en"],
    });
    // No tier-2 keys leak.
    expect(Object.keys(tier1).sort()).toEqual(
      [...TIER1_KEYS].sort() as string[],
    );
  });

  it("omits undefined tier-1 fields rather than emitting them as undefined", () => {
    const tier1 = pickTier1({ displayName: "Solo" });
    expect(tier1).toEqual({ displayName: "Solo" });
    expect("primaryLanguage" in tier1).toBe(false);
  });
});

describe("parseOperationalFactsData", () => {
  it("returns an empty envelope on null / undefined / non-object input", () => {
    expect(parseOperationalFactsData(null)).toEqual({});
    expect(parseOperationalFactsData(undefined)).toEqual({});
    expect(parseOperationalFactsData("not an object")).toEqual({});
    expect(parseOperationalFactsData(42)).toEqual({});
  });

  it("returns an empty envelope on shape-invalid input rather than throwing", () => {
    // Invalid: primaryLanguage must be one of the supported codes.
    expect(parseOperationalFactsData({ primaryLanguage: "klingon" })).toEqual({});
    // Invalid: hours.weekly[].open must be HH:MM.
    expect(
      parseOperationalFactsData({
        hours: { tz: "Africa/Algiers", weekly: [{ day: "mon", open: "9am", close: "5pm" }] },
      }),
    ).toEqual({});
  });

  it("parses a valid envelope through cleanly", () => {
    const out = parseOperationalFactsData({
      displayName: "Acme",
      primaryLanguage: "fr",
      hours: {
        tz: "Africa/Algiers",
        weekly: [{ day: "mon", open: "09:00", close: "17:00" }],
      },
      currency: "DZD",
    });
    expect(out.displayName).toBe("Acme");
    expect(out.primaryLanguage).toBe("fr");
    expect(out.hours?.weekly).toHaveLength(1);
    expect(out.currency).toBe("DZD");
  });
});
