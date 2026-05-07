import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeItem } from "@prisma/client";
import type * as ItemsModule from "@/server/db/items";

// Hoisted mocks: embed() and attachItemEmbedding() are the two boundary
// calls embedKnowledgeItem makes. Mock them so the test never hits Voyage,
// OpenAI, or Postgres.
const embedMock = vi.hoisted(() =>
  vi.fn<
    (args: { inputs: string[]; inputType: string }) => Promise<{
      vectors: number[][];
      provider: "voyage" | "openai";
      model: string;
    }>
  >(),
);
const attachMock = vi.hoisted(() =>
  vi.fn<(args: { itemId: string; vector: number[] }) => Promise<void>>(),
);

vi.mock("@/server/ai/embeddings", () => ({
  embed: embedMock,
}));

// db/items imports enqueueEmbedItems from queue/jobs at module load, which
// reaches queue/queues and instantiates Queue() against REDIS_URL. Mirror
// the typed-knowledge.test.ts shim so the import graph never touches Redis.
vi.mock("@/server/queue/jobs", () => ({
  enqueueEmbedItems: vi.fn(async () => {}),
  enqueueEmbedQna: vi.fn(async () => {}),
  enqueueEmbedKnowledgeGap: vi.fn(async () => {}),
}));

vi.mock("@/server/db/items", async () => {
  // Keep buildItemEmbedText as the real implementation — it's a pure helper
  // we want to exercise. Only attachItemEmbedding is stubbed (it issues raw
  // SQL and would hit Postgres).
  const real = await vi.importActual<typeof ItemsModule>("@/server/db/items");
  return {
    ...real,
    attachItemEmbedding: attachMock,
  };
});

const { embedKnowledgeItem } = await import("./embed-item");

const ZERO_VECTOR = Array.from({ length: 1024 }, () => 0);

function buildItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: "item_1",
    tenantId: "tenant_1",
    name: "Refrigerator XL-200",
    category: "Appliances",
    externalId: null,
    sku: "FR-XL200",
    brand: "Acme",
    currency: "DZD",
    priceCents: 9999900,
    availability: "IN_STOCK",
    description: "Large family refrigerator with frost-free freezer.",
    specs: { color: "silver", capacity_l: 450 },
    lastVerifiedAt: null,
    liveDataSourceId: null,
    sourceUpdatedAt: null,
    lastSyncedAt: null,
    quantityOnHand: null,
    quantityAvailable: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KnowledgeItem;
}

beforeEach(() => {
  embedMock.mockReset();
  attachMock.mockReset();
  embedMock.mockResolvedValue({
    vectors: [ZERO_VECTOR],
    provider: "voyage",
    model: "voyage-3-large",
  });
  attachMock.mockResolvedValue(undefined);
});

describe("embedKnowledgeItem", () => {
  it("calls embed() with name + brand + sku + description + specs joined per buildItemEmbedText", async () => {
    await embedKnowledgeItem(buildItem());

    expect(embedMock).toHaveBeenCalledTimes(1);
    const call = embedMock.mock.calls[0]?.[0];
    expect(call?.inputType).toBe("document");
    expect(call?.inputs).toHaveLength(1);
    const text = call?.inputs[0] ?? "";
    expect(text).toContain("Refrigerator XL-200");
    expect(text).toContain("Acme");
    expect(text).toContain("FR-XL200");
    expect(text).toContain("Large family refrigerator");
    expect(text).toContain("color: silver");
    expect(text).toContain("capacity_l: 450");
  });

  it("excludes null/empty fields from the composed embed text", async () => {
    await embedKnowledgeItem(
      buildItem({
        brand: null,
        category: null,
        sku: null,
        description: null,
        specs: {},
      }),
    );

    const call = embedMock.mock.calls[0]?.[0];
    const text = call?.inputs[0] ?? "";
    // Only the name should appear; nothing for the null-or-empty fields.
    expect(text).toBe("Refrigerator XL-200");
  });

  it("writes the returned vector to KnowledgeItem.embedding via attachItemEmbedding", async () => {
    const vec = Array.from({ length: 1024 }, (_, i) => i / 1024);
    embedMock.mockResolvedValueOnce({
      vectors: [vec],
      provider: "voyage",
      model: "voyage-3-large",
    });

    await embedKnowledgeItem(buildItem({ id: "item_42" }));

    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledWith({ itemId: "item_42", vector: vec });
  });

  it("does not call embed() or attachItemEmbedding() when the composed text is empty", async () => {
    // buildItemEmbedText drops null/empty parts. An item with only an empty
    // name (after trim) produces empty text and should short-circuit.
    await embedKnowledgeItem(
      buildItem({
        name: "   ",
        brand: null,
        category: null,
        sku: null,
        description: null,
        specs: {},
      }),
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("propagates errors from embed() (caller decides whether to abort or skip)", async () => {
    embedMock.mockRejectedValueOnce(new Error("voyage 503"));
    await expect(embedKnowledgeItem(buildItem())).rejects.toThrow(/voyage 503/);
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("propagates errors from attachItemEmbedding()", async () => {
    attachMock.mockRejectedValueOnce(new Error("pg connection lost"));
    await expect(embedKnowledgeItem(buildItem())).rejects.toThrow(
      /pg connection lost/,
    );
  });
});
