import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { KnowledgeItem, LiveDataSource } from "@prisma/client";
import { encryptConfig } from "../../crypto";

// Hoisted mocks: OdooClient is replaced with a programmable stub, and
// the prisma client's two methods we exercise (knowledgeItem.upsert,
// liveDataSource.update) are spied on.

const { authenticateMock, searchReadMock, executeKwMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn<() => Promise<number>>(),
  searchReadMock: vi.fn<
    (
      model: string,
      domain: unknown[],
      fields: string[],
      opts: { limit?: number; offset?: number },
    ) => Promise<unknown[]>
  >(),
  executeKwMock: vi.fn<
    (
      model: string,
      method: string,
      args: unknown[],
      kwargs?: Record<string, unknown>,
    ) => Promise<unknown>
  >(),
}));

vi.mock("../client", () => {
  return {
    OdooClient: class {
      authenticate = authenticateMock;
      searchRead = searchReadMock;
      executeKw = executeKwMock;
    },
  };
});

const upsertMock = vi.hoisted(() => vi.fn<(args: unknown) => Promise<unknown>>());
const updateMock = vi.hoisted(() => vi.fn<(args: unknown) => Promise<unknown>>());
vi.mock("@/server/db/client", () => ({
  prisma: {
    knowledgeItem: { upsert: upsertMock },
    liveDataSource: { update: updateMock },
  },
}));

// Mock the embed helper so the sync test never hits Voyage / OpenAI / pg.
const embedItemMock = vi.hoisted(() =>
  vi.fn<(item: KnowledgeItem) => Promise<void>>(),
);
vi.mock("@/server/knowledge/embed-item", () => ({
  embedKnowledgeItem: embedItemMock,
}));

const VALID_KEY = randomBytes(32).toString("base64");

function buildSource(
  overrides: Partial<LiveDataSource> = {},
): LiveDataSource {
  const config = JSON.stringify({
    url: "https://example.test",
    database: "demo",
    username: "user@example.test",
    password: "pw-do-not-leak-12345",
    additionalFields: { brandField: "marque_id" },
  });
  return {
    id: "src_test",
    tenantId: "tenant_test",
    type: "ODOO",
    name: "Test source",
    encryptedConfig: encryptConfig(config),
    status: "CONNECTED",
    lastSyncedAt: null,
    lastSyncStartedAt: null,
    lastSyncError: null,
    syncedRecordCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildOdooProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    name: "Sample Product",
    default_code: "SKU-101",
    list_price: 199.99,
    standard_price: 100,
    qty_available: 5,
    virtual_available: 5,
    categ_id: [3, "Electronics"],
    // Odoo many2one shape: [id, "Display Name"]. Default to DZD since that's
    // the production WBP currency; tests overriding to `false` exercise the
    // unset path. The wire-shape sync.ts cares about is currency_id; the
    // typed schema (models.ts) also surfaces it as optional.
    currency_id: [123, "DZD"],
    type: "product",
    sale_ok: true,
    active: true,
    write_date: "2026-05-06 09:30:00",
    barcode: "1234567890",
    description_sale: "A nice product.",
    marque_id: [11, "Acme"],
    ...overrides,
  };
}

const { syncOdooProducts } = await import("../sync");

describe("syncOdooProducts", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.LIVE_DATA_ENCRYPTION_KEY;
    process.env.LIVE_DATA_ENCRYPTION_KEY = VALID_KEY;

    authenticateMock.mockReset();
    searchReadMock.mockReset();
    executeKwMock.mockReset();
    upsertMock.mockReset();
    updateMock.mockReset();
    embedItemMock.mockReset();

    authenticateMock.mockResolvedValue(7);
    // Return a minimally-shaped KnowledgeItem row so embedKnowledgeItem
    // can be called against it. The id is what the embed call key off
    // of; fields are filler for the type.
    upsertMock.mockImplementation(async (args) => {
      const a = args as { create: { externalId?: string; tenantId: string } };
      return {
        id: `item_${a.create.externalId ?? "x"}`,
        tenantId: a.create.tenantId,
        name: "stub",
        category: null,
        externalId: a.create.externalId ?? null,
        sku: null,
        brand: null,
        currency: null,
        priceCents: null,
        availability: "UNKNOWN",
        description: null,
        specs: {},
        lastVerifiedAt: null,
        liveDataSourceId: null,
        sourceUpdatedAt: null,
        lastSyncedAt: null,
        quantityOnHand: null,
        quantityAvailable: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
    updateMock.mockResolvedValue({});
    embedItemMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.LIVE_DATA_ENCRYPTION_KEY;
    } else {
      process.env.LIVE_DATA_ENCRYPTION_KEY = originalKey;
    }
  });

  it("does NOT include a write_date filter on first sync (lastSyncedAt=null)", async () => {
    const source = buildSource({ lastSyncedAt: null });
    searchReadMock.mockResolvedValueOnce([]);
    await syncOdooProducts(source);
    expect(searchReadMock).toHaveBeenCalledTimes(1);
    const domain = searchReadMock.mock.calls[0]?.[1];
    expect(domain).toEqual([
      ["sale_ok", "=", true],
      ["active", "=", true],
    ]);
  });

  it("includes a write_date filter on delta sync (lastSyncedAt set)", async () => {
    const source = buildSource({
      lastSyncedAt: new Date("2026-05-05T12:34:56Z"),
    });
    searchReadMock.mockResolvedValueOnce([]);
    await syncOdooProducts(source);
    const domain = searchReadMock.mock.calls[0]?.[1];
    expect(domain).toEqual([
      ["sale_ok", "=", true],
      ["active", "=", true],
      ["write_date", ">", "2026-05-05 12:34:56"],
    ]);
  });

  it("paginates: stops when a page returns < PAGE_SIZE records", async () => {
    const PAGE = 200;
    const source = buildSource();
    const fullPage = Array.from({ length: PAGE }, (_, i) =>
      buildOdooProduct({ id: i + 1 }),
    );
    const partialPage = Array.from({ length: 17 }, (_, i) =>
      buildOdooProduct({ id: PAGE + i + 1 }),
    );
    searchReadMock
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(partialPage);
    const result = await syncOdooProducts(source);
    expect(searchReadMock).toHaveBeenCalledTimes(2);
    expect(searchReadMock.mock.calls[1]?.[3]).toEqual({
      limit: PAGE,
      offset: PAGE,
    });
    expect(upsertMock).toHaveBeenCalledTimes(PAGE + 17);
    expect(result.recordsProcessed).toBe(PAGE + 17);
    expect(result.isDelta).toBe(false);
  });

  it("upserts to KnowledgeItem with the correct shape (composite key, mapped fields)", async () => {
    const source = buildSource();
    searchReadMock.mockResolvedValueOnce([buildOdooProduct()]);
    await syncOdooProducts(source);

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const args = upsertMock.mock.calls[0]?.[0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({
      tenantId_liveDataSourceId_externalId: {
        tenantId: "tenant_test",
        liveDataSourceId: "src_test",
        externalId: "101",
      },
    });
    expect(args.create).toMatchObject({
      tenantId: "tenant_test",
      liveDataSourceId: "src_test",
      externalId: "101",
      name: "Sample Product",
      sku: "SKU-101",
      priceCents: 19999,
      availability: "IN_STOCK",
      quantityOnHand: 5,
      quantityAvailable: 5,
      category: "Electronics",
      brand: "Acme",
      description: "A nice product.",
    });
  });

  it("maps qty_available=0 to OUT_OF_STOCK", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ qty_available: 0, virtual_available: 0 }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { availability: string };
    };
    expect(args.create.availability).toBe("OUT_OF_STOCK");
  });

  it("treats Odoo's `false` literal for default_code as null SKU", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ default_code: false }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { sku: string | null };
    };
    expect(args.create.sku).toBeNull();
  });

  it("treats Odoo's `false` literal for description_sale as null description", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ description_sale: false }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { description: string | null };
    };
    expect(args.create.description).toBeNull();
  });

  it("extracts brand from the configured custom many2one field", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ marque_id: [42, "Special Brand"] }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { brand: string | null };
    };
    expect(args.create.brand).toBe("Special Brand");
  });

  it("brand is null when the custom field is `false` AND the name doesn't start with a known brand", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ marque_id: false, name: "Onduleur 1500VA" }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { brand: string | null };
    };
    expect(args.create.brand).toBeNull();
  });

  it("falls back to inferred brand when the custom field is `false` AND name starts with a known brand", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ marque_id: false, name: "AJAX Hub Plus" }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { brand: string | null };
    };
    expect(args.create.brand).toBe("Ajax");
  });

  it("falls back to inferred brand when the source has NO brandField configured at all", async () => {
    // WBP case: Tayssir's brand field name is unknown, so additionalFields
    // is omitted entirely. Inference still kicks in for branded names.
    const noBrandFieldConfig = JSON.stringify({
      url: "https://example.test",
      database: "demo",
      username: "user@example.test",
      password: "pw-do-not-leak-12345",
    });
    const source: LiveDataSource = {
      ...buildSource(),
      encryptedConfig: encryptConfig(noBrandFieldConfig),
    };
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ name: "Dahua HDCVI 2MP Dome" }),
    ]);
    await syncOdooProducts(source);
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { brand: string | null };
    };
    expect(args.create.brand).toBe("Dahua");
  });

  it("explicit brandField value wins over name inference", async () => {
    // Even if name starts with "AJAX", an explicit marque_id "Other" overrides.
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({
        marque_id: [99, "Other Brand"],
        name: "AJAX Hub Plus",
      }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { brand: string | null };
    };
    expect(args.create.brand).toBe("Other Brand");
  });

  it("extracts currency display-name from currency_id many2one", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ currency_id: [123, "DZD"] }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { currency: string | null };
    };
    expect(args.create.currency).toBe("DZD");
  });

  it("maps non-DZD currency display-names through as-is (EUR, USD)", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ currency_id: [2, "EUR"], id: 200 }),
      buildOdooProduct({ currency_id: [1, "USD"], id: 201 }),
    ]);
    await syncOdooProducts(buildSource());
    expect(
      (upsertMock.mock.calls[0]?.[0] as { create: { currency: string | null } })
        .create.currency,
    ).toBe("EUR");
    expect(
      (upsertMock.mock.calls[1]?.[0] as { create: { currency: string | null } })
        .create.currency,
    ).toBe("USD");
  });

  it("currency is null when currency_id is `false` (unset)", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ currency_id: false }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { currency: string | null };
    };
    expect(args.create.currency).toBeNull();
  });

  it("currency is null when currency_id is missing entirely from the payload", async () => {
    const productNoCurrency = buildOdooProduct();
    delete (productNoCurrency as Record<string, unknown>).currency_id;
    searchReadMock.mockResolvedValueOnce([productNoCurrency]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { currency: string | null };
    };
    expect(args.create.currency).toBeNull();
  });

  it("requests currency_id in the field list", async () => {
    searchReadMock.mockResolvedValueOnce([]);
    await syncOdooProducts(buildSource());
    const fields = searchReadMock.mock.calls[0]?.[2];
    expect(fields).toContain("currency_id");
  });

  it("on success: clears lastSyncStartedAt, sets lastSyncedAt, status=CONNECTED, increments syncedRecordCount", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct(),
      buildOdooProduct({ id: 102 }),
    ]);
    await syncOdooProducts(buildSource());
    // Two updates: start and success.
    expect(updateMock).toHaveBeenCalledTimes(2);
    const startCall = updateMock.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    const successCall = updateMock.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(startCall.data).toMatchObject({
      lastSyncStartedAt: expect.any(Date) as Date,
      lastSyncError: null,
    });
    expect(successCall.data).toMatchObject({
      lastSyncedAt: expect.any(Date) as Date,
      lastSyncStartedAt: null,
      syncedRecordCount: { increment: 2 },
      status: "CONNECTED",
      lastSyncError: null,
    });
  });

  it("on failure: clears lastSyncStartedAt, sets status=ERROR, lastSyncError = message, rethrows", async () => {
    searchReadMock.mockRejectedValueOnce(new Error("upstream timeout"));
    await expect(syncOdooProducts(buildSource())).rejects.toThrow(
      /upstream timeout/,
    );
    expect(updateMock).toHaveBeenCalledTimes(2);
    const failCall = updateMock.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(failCall.data).toMatchObject({
      lastSyncStartedAt: null,
      status: "ERROR",
      lastSyncError: "upstream timeout",
    });
  });

  it("skips records that fail Zod validation (logged warning, not thrown)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct(),
      // Missing required fields → schema fail, skip
      { id: 999, partial: true },
      buildOdooProduct({ id: 102 }),
    ]);
    const result = await syncOdooProducts(buildSource());
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(result.recordsProcessed).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not include the password in any update.data field on the failure path", async () => {
    searchReadMock.mockRejectedValueOnce(new Error("upstream blew up"));
    try {
      await syncOdooProducts(buildSource());
    } catch {
      // Expected.
    }
    const allUpdateData = updateMock.mock.calls.map(
      (c) => JSON.stringify((c[0] as { data?: unknown })?.data ?? {}),
    );
    for (const blob of allUpdateData) {
      expect(blob).not.toContain("pw-do-not-leak-12345");
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Embedding wiring (Live Data freshness — make synced items retrievable)
  // ───────────────────────────────────────────────────────────────────────

  it("calls embedKnowledgeItem once per successful upsert", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct(),
      buildOdooProduct({ id: 102 }),
      buildOdooProduct({ id: 103 }),
    ]);
    const result = await syncOdooProducts(buildSource());
    expect(upsertMock).toHaveBeenCalledTimes(3);
    expect(embedItemMock).toHaveBeenCalledTimes(3);
    expect(result.embeddingsFailed).toBe(0);
  });

  it("does not call embedKnowledgeItem for records that fail Zod validation", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct(),
      { id: 999, partial: true }, // schema-fail; skipped
      buildOdooProduct({ id: 102 }),
    ]);
    await syncOdooProducts(buildSource());
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(embedItemMock).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("embedding failure is logged but does not abort the sync", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    embedItemMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("voyage 503 + openai down"))
      .mockResolvedValueOnce(undefined);

    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ id: 1 }),
      buildOdooProduct({ id: 2 }),
      buildOdooProduct({ id: 3 }),
    ]);
    const result = await syncOdooProducts(buildSource());
    // All three rows still upserted.
    expect(upsertMock).toHaveBeenCalledTimes(3);
    expect(result.recordsProcessed).toBe(3);
    expect(result.embeddingsFailed).toBe(1);
    // Warning logged for the failed item; password from the source config
    // never leaks into the warning.
    expect(warnSpy).toHaveBeenCalled();
    const warnings = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnings).toMatch(/Failed to embed item .+ during sync: voyage 503/);
    expect(warnings).not.toContain("pw-do-not-leak-12345");
    warnSpy.mockRestore();
  });

  it("embeddingsFailed counter starts at 0 when all embeddings succeed", async () => {
    searchReadMock.mockResolvedValueOnce([buildOdooProduct()]);
    const result = await syncOdooProducts(buildSource());
    expect(result.embeddingsFailed).toBe(0);
    expect(embedItemMock).toHaveBeenCalledTimes(1);
  });
});
