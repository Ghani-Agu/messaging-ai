import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { LiveDataSource } from "@prisma/client";
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

    authenticateMock.mockResolvedValue(7);
    upsertMock.mockResolvedValue({});
    updateMock.mockResolvedValue({});
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

  it("brand is null when the custom field is `false` (unset)", async () => {
    searchReadMock.mockResolvedValueOnce([
      buildOdooProduct({ marque_id: false }),
    ]);
    await syncOdooProducts(buildSource());
    const args = upsertMock.mock.calls[0]?.[0] as {
      create: { brand: string | null };
    };
    expect(args.create.brand).toBeNull();
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
});
