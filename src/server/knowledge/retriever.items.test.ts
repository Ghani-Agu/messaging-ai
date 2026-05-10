import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemAvailability } from "@prisma/client";

vi.mock("@/server/ai/embeddings", () => ({
  embed: vi.fn(async () => ({
    vectors: [[0.1, 0.2, 0.3]],
    provider: "voyage" as const,
  })),
}));

vi.mock("@/server/db/items", () => ({
  vectorSearchItems: vi.fn(),
  lexicalSearchItems: vi.fn(),
  keywordSearchItems: vi.fn(),
  getBrandAggregate: vi.fn(),
}));

// retriever.ts also imports db/qna + db/knowledge for the other channels;
// no-op mocks so importing the module doesn't pull a real DB client.
vi.mock("@/server/db/qna", () => ({ vectorSearchQna: vi.fn() }));
vi.mock("@/server/db/knowledge", () => ({
  vectorSearch: vi.fn(),
  lexicalSearch: vi.fn(),
}));

import {
  getBrandAggregate,
  keywordSearchItems,
  lexicalSearchItems,
  vectorSearchItems,
} from "@/server/db/items";
import { extractSignificantTokens, retrieveItems } from "./retriever";

beforeEach(() => {
  vi.clearAllMocks();
  // Default brand-aggregate mock — the brand-summary tests below override
  // it case by case. The keyword-merge tests above are not about brand
  // summaries; they shouldn't crash if their fixtures happen to include
  // a brand that crosses BRAND_SUMMARY_THRESHOLD.
  vi.mocked(getBrandAggregate).mockResolvedValue({
    total: 0,
    inStock: 0,
    outOfStock: 0,
    categories: [],
  });
});

const mkHit = (overrides: {
  itemId: string;
  name?: string;
  brand?: string | null;
  availability?: ItemAvailability;
  score?: number;
}) => ({
  itemId: overrides.itemId,
  name: overrides.name ?? `Item ${overrides.itemId}`,
  category: null,
  brand: overrides.brand ?? null,
  sku: null,
  currency: null,
  priceCents: null,
  availability: overrides.availability ?? ("UNKNOWN" as ItemAvailability),
  description: null,
  specs: {},
  score: overrides.score ?? 0.5,
});

describe("extractSignificantTokens", () => {
  it("strips Darija/French/English stopwords", () => {
    expect(extractSignificantTokens("wsh 3andkom Ajax")).toEqual(["Ajax"]);
    expect(extractSignificantTokens("est-ce que vous avez des caméras")).toEqual([
      "avez",
      "caméras",
    ]);
  });

  it("drops tokens shorter than 3 chars", () => {
    expect(extractSignificantTokens("AJAX DH XVR")).toEqual(["AJAX", "XVR"]);
  });

  it("deduplicates case-insensitively", () => {
    expect(extractSignificantTokens("ajax AJAX Ajax")).toEqual(["ajax"]);
  });

  it("preserves original case for the keyword search to use", () => {
    expect(extractSignificantTokens("Ajax Hub")).toEqual(["Ajax", "Hub"]);
  });

  it("caps at 6 tokens to bound per-token DB queries", () => {
    const long = "alpha beta gamma delta epsilon zeta eta theta iota";
    expect(extractSignificantTokens(long)).toHaveLength(6);
  });
});

describe("retrieveItems — keyword merge path", () => {
  it("keyword finds >= 3 → keyword matches occupy the top 5 slots", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([
      mkHit({ itemId: "v1", score: 0.95 }),
      mkHit({ itemId: "v2", score: 0.9 }),
    ]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue([
      mkHit({ itemId: "k1", brand: "Ajax", score: 2.0 }),
      mkHit({ itemId: "k2", brand: "Ajax", score: 2.0 }),
      mkHit({ itemId: "k3", brand: "Ajax", score: 2.0 }),
    ]);
    const r = await retrieveItems({
      tenantId: "t",
      query: "ajax",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    // First three slots are keyword matches (preserving order from
    // runKeywordSearch's score-sorted output).
    expect(r.items.slice(0, 3).map((it) => it.itemId)).toEqual(["k1", "k2", "k3"]);
    // Vector top results fill remaining slots in the merge.
    expect(r.items.map((it) => it.itemId)).toEqual(["k1", "k2", "k3", "v1", "v2"]);
  });

  it("keyword < 3 → falls back to pure RRF (identical to pre-merge behaviour)", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([
      mkHit({ itemId: "v1", score: 0.95 }),
      mkHit({ itemId: "v2", score: 0.9 }),
      mkHit({ itemId: "v3", score: 0.85 }),
    ]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue([
      mkHit({ itemId: "k1", score: 2.0 }),
    ]);
    const r = await retrieveItems({
      tenantId: "t",
      query: "ajax",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    // Only 1 keyword hit → below the merge threshold → vector results
    // win their natural ranking.
    expect(r.items.map((it) => it.itemId)).toEqual(["v1", "v2", "v3"]);
  });

  it("deduplicates when keyword and vector return overlapping items", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([
      mkHit({ itemId: "shared", score: 0.9 }),
      mkHit({ itemId: "v-only", score: 0.85 }),
    ]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue([
      mkHit({ itemId: "shared", brand: "Ajax", score: 2.0 }),
      mkHit({ itemId: "k1", brand: "Ajax", score: 2.0 }),
      mkHit({ itemId: "k2", brand: "Ajax", score: 2.0 }),
    ]);
    const r = await retrieveItems({
      tenantId: "t",
      query: "ajax",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    const ids = r.items.map((it) => it.itemId);
    // "shared" appears exactly once.
    expect(ids.filter((id) => id === "shared")).toHaveLength(1);
    // No duplicates anywhere.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("empty query short-circuits to no items / no summaries", async () => {
    const r = await retrieveItems({ tenantId: "t", query: "   " });
    expect(r.items).toEqual([]);
    expect(r.brandSummaries).toEqual([]);
    // None of the search functions should have been called.
    expect(vectorSearchItems).not.toHaveBeenCalled();
    expect(keywordSearchItems).not.toHaveBeenCalled();
  });
});

describe("retrieveItems — brand summaries (catalog aggregate + category breakdown)", () => {
  it("emits a category-broken summary for each brand with >= 3 keyword hits", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    // 11 Ajax in keyword pool (triggers); 2 Dahua (below threshold).
    vi.mocked(keywordSearchItems).mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) =>
        mkHit({
          itemId: `ax-in-${i}`,
          brand: "Ajax",
          availability: "IN_STOCK",
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        mkHit({
          itemId: `ax-out-${i}`,
          brand: "Ajax",
          availability: "OUT_OF_STOCK",
        }),
      ),
      mkHit({ itemId: "dh-1", brand: "Dahua", availability: "IN_STOCK" }),
      mkHit({ itemId: "dh-2", brand: "Dahua", availability: "OUT_OF_STOCK" }),
    ]);
    // Full-catalog aggregate for Ajax — exists in one category.
    vi.mocked(getBrandAggregate).mockResolvedValue({
      total: 11,
      inStock: 6,
      outOfStock: 5,
      categories: [{ category: "ALARM SYSTEM", count: 11, inStock: 6 }],
    });
    const r = await retrieveItems({
      tenantId: "t",
      query: "ajax",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    expect(getBrandAggregate).toHaveBeenCalledTimes(1);
    expect(getBrandAggregate).toHaveBeenCalledWith({
      tenantId: "t",
      brand: "Ajax",
      topCategories: 6,
    });
    expect(r.brandSummaries).toHaveLength(1);
    expect(r.brandSummaries[0]).toEqual({
      brand: "Ajax",
      total: 11,
      inStock: 6,
      outOfStock: 5,
      categoryBreakdown: [{ category: "ALARM SYSTEM", count: 11, inStock: 6 }],
    });
  });

  it("returns multi-category breakdown sorted by count desc", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue(
      Array.from({ length: 4 }, (_, i) =>
        mkHit({ itemId: `dh-${i}`, brand: "Dahua" }),
      ),
    );
    vi.mocked(getBrandAggregate).mockResolvedValue({
      total: 47,
      inStock: 28,
      outOfStock: 19,
      categories: [
        { category: "Caméras IP", count: 18, inStock: 12 },
        { category: "Interphones", count: 10, inStock: 6 },
        { category: "NVR", count: 8, inStock: 5 },
        { category: "Switches", count: 6, inStock: 4 },
        { category: "Access control", count: 5, inStock: 1 },
      ],
    });
    const r = await retrieveItems({
      tenantId: "t",
      query: "dahua",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    expect(r.brandSummaries).toHaveLength(1);
    const s = r.brandSummaries[0]!;
    expect(s.total).toBe(47);
    expect(s.categoryBreakdown.map((c) => c.category)).toEqual([
      "Caméras IP",
      "Interphones",
      "NVR",
      "Switches",
      "Access control",
    ]);
  });

  it("maps a null category from the DB aggregate into the 'Autres' bucket", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue(
      Array.from({ length: 4 }, (_, i) =>
        mkHit({ itemId: `x-${i}`, brand: "Misc" }),
      ),
    );
    vi.mocked(getBrandAggregate).mockResolvedValue({
      total: 4,
      inStock: 2,
      outOfStock: 0,
      categories: [
        { category: "Cables", count: 3, inStock: 2 },
        { category: null, count: 1, inStock: 0 },
      ],
    });
    const r = await retrieveItems({
      tenantId: "t",
      query: "misc",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    expect(r.brandSummaries[0]!.categoryBreakdown).toEqual([
      { category: "Cables", count: 3, inStock: 2 },
      { category: "Autres", count: 1, inStock: 0 },
    ]);
  });

  it("returns no summaries when no brand reaches the keyword threshold", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue([
      mkHit({ itemId: "1", brand: "Ajax" }),
      mkHit({ itemId: "2", brand: "Ajax" }),
      mkHit({ itemId: "3", brand: "Dahua" }),
    ]);
    const r = await retrieveItems({
      tenantId: "t",
      query: "produits",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    expect(r.brandSummaries).toEqual([]);
    expect(getBrandAggregate).not.toHaveBeenCalled();
  });

  it("caps brand fan-out at the configured max (top brands by keyword-pool count)", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    const make = (brand: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        mkHit({ itemId: `${brand}-${i}`, brand, availability: "IN_STOCK" }),
      );
    vi.mocked(keywordSearchItems).mockResolvedValue([
      ...make("Ajax", 10),
      ...make("Dahua", 7),
      ...make("Imou", 5),
      ...make("Hikvision", 4),
      ...make("Ubiquiti", 3),
    ]);
    vi.mocked(getBrandAggregate).mockImplementation(async ({ brand }) => ({
      total: 1,
      inStock: 1,
      outOfStock: 0,
      categories: [{ category: brand, count: 1, inStock: 1 }],
    }));
    const r = await retrieveItems({
      tenantId: "t",
      query: "produits",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    // BRAND_SUMMARY_MAX = 3. All 5 brands cross threshold; only the top
    // 3 by keyword-pool count fan out to the DB aggregate.
    expect(getBrandAggregate).toHaveBeenCalledTimes(3);
    expect(r.brandSummaries.map((s) => s.brand)).toEqual([
      "Ajax",
      "Dahua",
      "Imou",
    ]);
  });

  it("skips brand=null hits when picking trigger brands", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue([
      ...Array.from({ length: 5 }, (_, i) =>
        mkHit({ itemId: `n-${i}`, brand: null }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        mkHit({ itemId: `ax-${i}`, brand: "Ajax", availability: "IN_STOCK" }),
      ),
    ]);
    vi.mocked(getBrandAggregate).mockResolvedValue({
      total: 3,
      inStock: 3,
      outOfStock: 0,
      categories: [{ category: "ALARM SYSTEM", count: 3, inStock: 3 }],
    });
    const r = await retrieveItems({
      tenantId: "t",
      query: "produits",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    expect(r.brandSummaries).toHaveLength(1);
    expect(r.brandSummaries[0]!.brand).toBe("Ajax");
    expect(r.brandSummaries[0]!.total).toBe(3);
  });

  it("drops a brand whose catalog aggregate races to zero (concurrent delete)", async () => {
    vi.mocked(vectorSearchItems).mockResolvedValue([]);
    vi.mocked(lexicalSearchItems).mockResolvedValue([]);
    vi.mocked(keywordSearchItems).mockResolvedValue(
      Array.from({ length: 4 }, (_, i) =>
        mkHit({ itemId: `gone-${i}`, brand: "Vanished" }),
      ),
    );
    vi.mocked(getBrandAggregate).mockResolvedValue({
      total: 0,
      inStock: 0,
      outOfStock: 0,
      categories: [],
    });
    const r = await retrieveItems({
      tenantId: "t",
      query: "vanished",
      queryVector: [0.1, 0.2, 0.3],
      topK: 8,
    });
    expect(r.brandSummaries).toEqual([]);
  });
});
