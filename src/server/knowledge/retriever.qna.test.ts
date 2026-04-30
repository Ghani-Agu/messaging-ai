import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the embed call + the qna vector search so this test stays pure.
vi.mock("@/server/ai/embeddings", () => ({
  embed: vi.fn(async () => ({
    vectors: [[0.1, 0.2, 0.3]],
    provider: "voyage" as const,
  })),
}));

vi.mock("@/server/db/qna", () => ({
  vectorSearchQna: vi.fn(),
}));

// retriever.ts imports from db/items + db/knowledge for items + chunks
// search too — provide no-op mocks so importing retriever doesn't pull
// a real DB client transitively.
vi.mock("@/server/db/items", () => ({
  vectorSearchItems: vi.fn(),
  lexicalSearchItems: vi.fn(),
}));

vi.mock("@/server/db/knowledge", () => ({
  vectorSearch: vi.fn(),
  lexicalSearch: vi.fn(),
}));

import { vectorSearchQna } from "@/server/db/qna";
import { retrieveQnaMatches } from "./retriever";
import {
  QNA_CROSS_LANGUAGE_THRESHOLD,
  QNA_MATCH_THRESHOLD,
} from "./limits";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

const mkHit = (overrides: {
  qnaId?: string;
  score: number;
  language?: string | null;
  languageLock?: boolean;
}) => ({
  qnaId: overrides.qnaId ?? "qna-1",
  question: "Q?",
  answer: "A.",
  language: overrides.language ?? null,
  languageLock: overrides.languageLock ?? false,
  tags: [] as string[],
  score: overrides.score,
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-tier threshold (Phase 8e-3)
//
// SAME-language: 0.85 floor.
// CROSS-language: 0.65 floor.
// crossLanguageMatch flag: true when match fires below 0.85, regardless
// of which language pair produced it.
// ─────────────────────────────────────────────────────────────────────────────

describe("retrieveQnaMatches — same-language path (0.85 floor)", () => {
  it("fires when score is at or above 0.85; crossLanguageMatch=false", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "high", score: 0.92, language: "fr" }),
      mkHit({ qnaId: "right-at", score: QNA_MATCH_THRESHOLD, language: "fr" }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "fr",
    });
    expect(r).toHaveLength(2);
    expect(r.map((m) => m.qnaId)).toEqual(["high", "right-at"]);
    for (const m of r) {
      expect(m.crossLanguageMatch).toBe(false);
    }
  });

  it("does NOT fire below 0.85 — safety floor preserved", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "below", score: 0.84, language: "fr" }),
      mkHit({ qnaId: "well-below", score: 0.7, language: "fr" }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "fr",
    });
    expect(r).toEqual([]);
  });
});

describe("retrieveQnaMatches — cross-language path (0.65 floor)", () => {
  it("fires when score is at or above 0.65 across languages; crossLanguageMatch=true", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "mid", score: 0.75, language: "fr", languageLock: false }),
      mkHit({ qnaId: "right-at", score: QNA_CROSS_LANGUAGE_THRESHOLD, language: "fr", languageLock: false }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "ar", // different from fr → cross-language path
    });
    expect(r).toHaveLength(2);
    expect(r.map((m) => m.qnaId)).toEqual(["mid", "right-at"]);
    for (const m of r) {
      expect(m.crossLanguageMatch).toBe(true);
    }
  });

  it("does NOT fire below 0.65 across languages", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "below", score: 0.64, language: "fr" }),
      mkHit({ qnaId: "well-below", score: 0.4, language: "fr" }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "ar",
    });
    expect(r).toEqual([]);
  });

  it("treats null language on the Q&A as cross-language (relaxed floor)", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "no-lang", score: 0.7, language: null }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "fr",
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.crossLanguageMatch).toBe(true);
  });

  it("treats omitted detectedLanguage as cross-language (relaxed floor)", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "fr-no-detect", score: 0.7, language: "fr" }),
    ]);
    const r = await retrieveQnaMatches({ tenantId: "t", query: "x" });
    expect(r).toHaveLength(1);
    expect(r[0]!.crossLanguageMatch).toBe(true);
  });

  it("a high-scoring cross-language match (>= 0.85) is NOT flagged crossLanguageMatch", async () => {
    // Some semantic equivalences score very high cross-language.
    // Don't penalize them with the cross-language flag — the operator
    // only needs the indicator when the score is below the same-language
    // safety floor.
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "high-cross", score: 0.91, language: "fr" }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "ar",
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.crossLanguageMatch).toBe(false);
  });
});

describe("retrieveQnaMatches — language-lock filter (independent)", () => {
  it("drops locked Q&A across languages regardless of score", async () => {
    // Even at 0.99 cosine, a locked French Q&A doesn't match an Arabic
    // query. The lock is a hard filter, not threshold-relaxable.
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "fr-locked", score: 0.99, language: "fr", languageLock: true }),
      mkHit({ qnaId: "fr-unlocked", score: 0.7, language: "fr", languageLock: false }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "ar",
    });
    expect(r.map((m) => m.qnaId)).toEqual(["fr-unlocked"]);
    expect(r[0]!.crossLanguageMatch).toBe(true);
  });

  it("keeps locked Q&A when detected language matches the locked language", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "fr-locked", score: 0.92, language: "fr", languageLock: true }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "fr",
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.crossLanguageMatch).toBe(false);
  });
});

describe("retrieveQnaMatches — threshold overrides", () => {
  it("threshold overrides only the same-language floor", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "edge", score: 0.7, language: "fr" }),
    ]);
    // detectedLanguage matches the Q&A's → same-language path → uses
    // the override, not the default 0.85.
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "fr",
      threshold: 0.65,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.crossLanguageMatch).toBe(false); // still same-language path
  });

  it("crossLanguageThreshold overrides only the cross-language floor", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "below-0.65", score: 0.55, language: "fr" }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "ar",
      crossLanguageThreshold: 0.5,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.crossLanguageMatch).toBe(true);
  });
});

describe("retrieveQnaMatches — edge cases", () => {
  it("returns [] for empty query without hitting the DB", async () => {
    const r = await retrieveQnaMatches({ tenantId: "t", query: "  " });
    expect(r).toEqual([]);
    expect(vi.mocked(vectorSearchQna)).not.toHaveBeenCalled();
  });
});
