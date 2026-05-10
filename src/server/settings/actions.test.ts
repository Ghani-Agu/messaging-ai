import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks: requireTenantContext is the trust boundary the action
// crosses; the DB helper is the persistence boundary. Mocking both lets
// us assert role enforcement + merge intent without hitting Postgres.
const requireTenantContextMock = vi.hoisted(() =>
  vi.fn<
    (
      slug: string,
      opts?: { minRole?: "OWNER" | "ADMIN" | "AGENT" | "VIEWER" },
    ) => Promise<{
      user: { id: string };
      tenant: { id: string; slug: string; settings: unknown };
      membership: { role: "OWNER" };
    }>
  >(),
);
vi.mock("@/server/tenancy/context", () => ({
  requireTenantContext: requireTenantContextMock,
}));

const updateTenantAiBehaviorMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/db/tenancy", () => ({
  updateTenantAiBehavior: updateTenantAiBehaviorMock,
}));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const { updateAiBehaviorAction } = await import("./actions");

const SLUG = "wbp";
const TENANT_ID = "tenant_wbp";

beforeEach(() => {
  requireTenantContextMock.mockReset();
  updateTenantAiBehaviorMock.mockReset();
  revalidatePathMock.mockReset();

  requireTenantContextMock.mockResolvedValue({
    user: { id: "user_1" },
    tenant: { id: TENANT_ID, slug: SLUG, settings: {} },
    membership: { role: "OWNER" },
  });
  updateTenantAiBehaviorMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateAiBehaviorAction — role enforcement", () => {
  it("requires OWNER role", async () => {
    await updateAiBehaviorAction({
      tenantSlug: SLUG,
      aiBehavior: {
        showPrices: false,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });
    expect(requireTenantContextMock).toHaveBeenCalledWith(SLUG, {
      minRole: "OWNER",
    });
  });

  it("propagates the ForbiddenError from requireTenantContext", async () => {
    requireTenantContextMock.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      updateAiBehaviorAction({
        tenantSlug: SLUG,
        aiBehavior: {
          showPrices: false,
          showStockCounts: false,
          requireHumanForOrders: true,
        },
      }),
    ).rejects.toThrow(/Forbidden/);
    expect(updateTenantAiBehaviorMock).not.toHaveBeenCalled();
  });
});

describe("updateAiBehaviorAction — persistence + Zod parse", () => {
  it("forwards the validated payload to the DB helper", async () => {
    const result = await updateAiBehaviorAction({
      tenantSlug: SLUG,
      aiBehavior: {
        showPrices: true,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });
    expect(result).toEqual({ status: "saved" });
    expect(updateTenantAiBehaviorMock).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      aiBehavior: {
        showPrices: true,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });
  });

  it("rejects malformed input before touching the DB", async () => {
    await expect(
      updateAiBehaviorAction({
        tenantSlug: SLUG,
        // Deliberately wrong shape — bypassing TS to hit the runtime
        // Zod parse path.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        aiBehavior: { showPrices: "yes" as any, showStockCounts: false, requireHumanForOrders: true },
      }),
    ).rejects.toThrow();
    expect(updateTenantAiBehaviorMock).not.toHaveBeenCalled();
  });

  it("fills defaults via the schema when a partial object is passed in", async () => {
    // The action's signature requires a full AiBehavior, but the Zod
    // parse fills defaults — verify we don't reject a partial that
    // matches the runtime expectation.
    await updateAiBehaviorAction({
      tenantSlug: SLUG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiBehavior: { showPrices: true } as any,
    });
    expect(updateTenantAiBehaviorMock).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      aiBehavior: {
        showPrices: true,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });
  });

  it("revalidates the settings/ai path after a successful save", async () => {
    await updateAiBehaviorAction({
      tenantSlug: SLUG,
      aiBehavior: {
        showPrices: false,
        showStockCounts: false,
        requireHumanForOrders: true,
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/${SLUG}/settings/ai`);
  });
});
