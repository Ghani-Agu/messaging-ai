import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Prisma client so this test never hits the DB. We're pinning
// the merge intent (preserve voiceProfile, replace only aiBehavior) and
// the failure path (404 on missing tenant) — neither needs SQL.
vi.mock("./client", () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        tenant: {
          findUnique: (vi.mocked(undefined) as never), // overwritten below
          update: (vi.mocked(undefined) as never),
        },
      }),
    ),
  },
}));

import { prisma } from "./client";
import { updateTenantAiBehavior } from "./tenancy";

const findUnique = vi.fn();
const update = vi.fn();

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  // Rewire each test's $transaction so the callback gets a fresh tx
  // with our spy-able fns.
  vi.mocked(prisma.$transaction).mockImplementation(
    async (cb: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cb as any)({
        tenant: { findUnique, update },
      }),
  );
});

describe("updateTenantAiBehavior", () => {
  it("preserves an existing voiceProfile key when patching aiBehavior", async () => {
    findUnique.mockResolvedValue({
      settings: {
        voiceProfile: { tone: "formal", formality: 4 },
        brandVoice: "friendly-professional",
      },
    });
    update.mockResolvedValue({});

    await updateTenantAiBehavior({
      tenantId: "t1",
      aiBehavior: {
        showPrices: true,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0]![0]!;
    expect(call.where).toEqual({ id: "t1" });
    expect(call.data.settings).toEqual({
      voiceProfile: { tone: "formal", formality: 4 },
      brandVoice: "friendly-professional",
      aiBehavior: {
        showPrices: true,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });
  });

  it("replaces a prior aiBehavior key in place", async () => {
    findUnique.mockResolvedValue({
      settings: {
        voiceProfile: { tone: "casual" },
        aiBehavior: {
          showPrices: false,
          showStockCounts: false,
          requireHumanForOrders: true,
        },
      },
    });
    update.mockResolvedValue({});

    await updateTenantAiBehavior({
      tenantId: "t1",
      aiBehavior: {
        showPrices: true,
        showStockCounts: true,
        requireHumanForOrders: false,
      },
    });

    const call = update.mock.calls[0]![0]!;
    expect(call.data.settings.aiBehavior).toEqual({
      showPrices: true,
      showStockCounts: true,
      requireHumanForOrders: false,
    });
    // voiceProfile still present.
    expect(call.data.settings.voiceProfile).toEqual({ tone: "casual" });
  });

  it("starts from an empty object when settings is null / non-object", async () => {
    findUnique.mockResolvedValue({ settings: null });
    update.mockResolvedValue({});

    await updateTenantAiBehavior({
      tenantId: "t1",
      aiBehavior: {
        showPrices: false,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });

    const call = update.mock.calls[0]![0]!;
    expect(call.data.settings).toEqual({
      aiBehavior: {
        showPrices: false,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });
  });

  it("throws when the tenant row doesn't exist", async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      updateTenantAiBehavior({
        tenantId: "ghost",
        aiBehavior: {
          showPrices: false,
          showStockCounts: false,
          requireHumanForOrders: true,
        },
      }),
    ).rejects.toThrow(/tenant not found/);
    expect(update).not.toHaveBeenCalled();
  });
});
