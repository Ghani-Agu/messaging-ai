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

// retriever.ts imports from db/items for items search too — provide a no-op
// mock so importing retriever doesn't pull a real DB client transitively.
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
import { QNA_MATCH_THRESHOLD } from "./limits";

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

describe("retrieveQnaMatches — threshold filtering", () => {
  it("includes hits at or above the default threshold (0.85)", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "high", score: 0.92 }),
      mkHit({ qnaId: "right-at", score: QNA_MATCH_THRESHOLD }),
      mkHit({ qnaId: "low", score: 0.7 }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "what are your hours?",
    });
    expect(r.map((m) => m.qnaId)).toEqual(["high", "right-at"]);
  });

  it("respects a caller-supplied threshold override", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "top", score: 0.65 }),
      mkHit({ qnaId: "mid", score: 0.55 }),
      mkHit({ qnaId: "below", score: 0.4 }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "hi",
      threshold: 0.5,
    });
    expect(r.map((m) => m.qnaId)).toEqual(["top", "mid"]);
  });

  it("returns empty when no hit clears threshold", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "a", score: 0.5 }),
      mkHit({ qnaId: "b", score: 0.4 }),
    ]);
    const r = await retrieveQnaMatches({ tenantId: "t", query: "x" });
    expect(r).toEqual([]);
  });
});

describe("retrieveQnaMatches — language-lock filtering", () => {
  it("drops language-locked rows whose language differs from detectedLanguage", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "fr-locked", score: 0.95, language: "fr", languageLock: true }),
      mkHit({ qnaId: "ar-locked", score: 0.95, language: "ar", languageLock: true }),
      mkHit({ qnaId: "unlocked-fr", score: 0.95, language: "fr", languageLock: false }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "ar",
    });
    // fr-locked dropped (lang mismatch). ar-locked kept (lang match).
    // unlocked-fr kept regardless (lock off).
    expect(r.map((m) => m.qnaId).sort()).toEqual(["ar-locked", "unlocked-fr"]);
  });

  it("keeps language-locked rows when detectedLanguage is omitted (no filter)", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "fr-locked", score: 0.95, language: "fr", languageLock: true }),
    ]);
    const r = await retrieveQnaMatches({ tenantId: "t", query: "x" });
    // No detectedLanguage means we don't filter. Caller is responsible
    // for either passing the language or accepting cross-language matches.
    expect(r.map((m) => m.qnaId)).toEqual(["fr-locked"]);
  });

  it("keeps unlocked rows regardless of language", async () => {
    vi.mocked(vectorSearchQna).mockResolvedValue([
      mkHit({ qnaId: "unlocked", score: 0.9, language: "fr", languageLock: false }),
    ]);
    const r = await retrieveQnaMatches({
      tenantId: "t",
      query: "x",
      detectedLanguage: "ar", // mismatch but lock is off
    });
    expect(r.map((m) => m.qnaId)).toEqual(["unlocked"]);
  });
});

describe("retrieveQnaMatches — empty / edge inputs", () => {
  it("returns [] for empty query without hitting the DB", async () => {
    const r = await retrieveQnaMatches({ tenantId: "t", query: "  " });
    expect(r).toEqual([]);
    expect(vi.mocked(vectorSearchQna)).not.toHaveBeenCalled();
  });
});
