import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

// Mock prisma at the boundary — we exercise the filter / fan-out logic,
// not the SQL. tenantUser.findMany returns the members; notification.
// createMany captures the rows we hand it (and returns a Prisma-shape
// `{ count }` result).
const findManyMock = vi.hoisted(() => vi.fn());
const createManyMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/db/client", () => ({
  prisma: {
    tenantUser: { findMany: findManyMock },
    notification: { createMany: createManyMock },
  },
}));

const { createHandoffNotifications, composeHandoffSummary } = await import(
  "./create"
);

const TENANT = "tenant_wbp";
const CONV = "conv_1";

beforeEach(() => {
  findManyMock.mockReset();
  createManyMock.mockReset();
  createManyMock.mockImplementation(async ({ data }: { data: unknown[] }) => ({
    count: data.length,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

type MemberRow = {
  userId: string;
  role: Role;
  permissions: string[];
};

function members(rows: MemberRow[]): MemberRow[] {
  return rows;
}

describe("composeHandoffSummary", () => {
  it("short message: body interpolates identifier + channel + message + reason", () => {
    const out = composeHandoffSummary(
      {
        customerMessage: "Quel est le prix du Macbook Pro M3 ?",
        customerIdentifier: "+213555000111",
        channel: "whatsapp",
      },
      "EXPLICIT_REQUEST",
    );
    expect(out.title).toBe("AI requested human handoff");
    expect(out.body).toBe(
      `+213555000111 on whatsapp: "Quel est le prix du Macbook Pro M3 ?" (reason: EXPLICIT_REQUEST)`,
    );
  });

  it("message >140 chars: excerpt truncates at 140 with ellipsis, reason still appended", () => {
    const long = "A".repeat(200);
    const out = composeHandoffSummary(
      {
        customerMessage: long,
        customerIdentifier: "psid_xyz",
        channel: "messenger",
      },
      "LOW_CONFIDENCE",
    );
    // 140 A's + the … glyph inside the quotes, then the reason suffix.
    const expectedExcerpt = "A".repeat(140) + "…";
    expect(out.body).toBe(
      `psid_xyz on messenger: "${expectedExcerpt}" (reason: LOW_CONFIDENCE)`,
    );
    // Sanity: real text content fits the cap (140 As + the ellipsis char).
    expect(out.body.includes("A".repeat(141))).toBe(false);
  });

  it("missing customerIdentifier: falls back to 'Customer'", () => {
    const out = composeHandoffSummary(
      {
        customerMessage: "Hello",
        channel: "widget",
      },
      "OUTSIDE_SCOPE",
    );
    expect(out.body).toBe(
      `Customer on widget: "Hello" (reason: OUTSIDE_SCOPE)`,
    );
  });
});

describe("createHandoffNotifications", () => {
  it("(a) creates one row per eligible user", async () => {
    findManyMock.mockResolvedValue(
      members([
        { userId: "u_owner", role: "OWNER", permissions: [] },
        {
          userId: "u_agent",
          role: "AGENT",
          permissions: ["conversations:view", "conversations:edit"],
        },
      ]),
    );

    const count = await createHandoffNotifications({
      tenantId: TENANT,
      conversationId: CONV,
      reason: "LOW_CONFIDENCE",
      context: {
        customerMessage: "Quel prix ?",
        customerIdentifier: "+213555000111",
        channel: "whatsapp",
      },
    });

    expect(count).toBe(2);
    expect(createManyMock).toHaveBeenCalledOnce();
    const rows = createManyMock.mock.calls[0]![0].data as Array<{
      userId: string;
    }>;
    expect(rows.map((r) => r.userId).sort()).toEqual(["u_agent", "u_owner"]);
  });

  it("(b) excludes users without conversations:view (e.g. VIEWER with the slug stripped, or arbitrary stored set)", async () => {
    findManyMock.mockResolvedValue(
      members([
        // OWNER always passes (getEffectivePermissions short-circuits).
        { userId: "u_owner", role: "OWNER", permissions: [] },
        // ADMIN with only a non-relevant slug — explicitly NOT
        // conversations:view. ADMIN doesn't short-circuit; only OWNER does.
        // The stored permissions array is what counts for non-OWNER roles.
        {
          userId: "u_admin_stripped",
          role: "ADMIN",
          permissions: ["dashboard:view"],
        },
        // AGENT carrying the slug — passes.
        {
          userId: "u_agent_ok",
          role: "AGENT",
          permissions: ["conversations:view"],
        },
        // VIEWER missing the slug — excluded.
        {
          userId: "u_viewer_no",
          role: "VIEWER",
          permissions: ["dashboard:view"],
        },
      ]),
    );

    const count = await createHandoffNotifications({
      tenantId: TENANT,
      conversationId: CONV,
      reason: "LOW_CONFIDENCE",
      context: {
        customerMessage: "Hi",
        channel: "widget",
      },
    });

    expect(count).toBe(2);
    const rows = createManyMock.mock.calls[0]![0].data as Array<{
      userId: string;
    }>;
    expect(rows.map((r) => r.userId).sort()).toEqual([
      "u_agent_ok",
      "u_owner",
    ]);
  });

  it("(c) zero eligible users → returns 0, never calls createMany", async () => {
    findManyMock.mockResolvedValue([] as MemberRow[]);

    const count = await createHandoffNotifications({
      tenantId: TENANT,
      conversationId: CONV,
      reason: "LOW_CONFIDENCE",
      context: {
        customerMessage: "Hi",
        channel: "widget",
      },
    });

    expect(count).toBe(0);
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("(c2) all members lack conversations:view → returns 0, never calls createMany", async () => {
    findManyMock.mockResolvedValue(
      members([
        { userId: "u1", role: "ADMIN", permissions: ["dashboard:view"] },
        { userId: "u2", role: "VIEWER", permissions: ["dashboard:view"] },
      ]),
    );

    const count = await createHandoffNotifications({
      tenantId: TENANT,
      conversationId: CONV,
      reason: "LOW_CONFIDENCE",
      context: {
        customerMessage: "Hi",
        channel: "widget",
      },
    });

    expect(count).toBe(0);
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("(d) sets all fields correctly on every row (tenantId, userId, type, conversationId, title, body)", async () => {
    findManyMock.mockResolvedValue(
      members([
        {
          userId: "u_agent",
          role: "AGENT",
          permissions: ["conversations:view"],
        },
      ]),
    );

    await createHandoffNotifications({
      tenantId: TENANT,
      conversationId: CONV,
      reason: "EXPLICIT_REQUEST",
      context: {
        customerMessage: "Je veux parler à un humain",
        customerIdentifier: "+213555000111",
        channel: "whatsapp",
      },
    });

    const rows = createManyMock.mock.calls[0]![0].data as Array<{
      tenantId: string;
      userId: string;
      type: string;
      conversationId: string | null;
      title: string;
      body: string;
    }>;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      tenantId: TENANT,
      userId: "u_agent",
      type: "AI_HANDOFF_REQUESTED",
      conversationId: CONV,
      title: "AI requested human handoff",
      body: `+213555000111 on whatsapp: "Je veux parler à un humain" (reason: EXPLICIT_REQUEST)`,
    });
    // Tenant-scoping invariant — every row MUST carry tenantId. The
    // schema comment makes this load-bearing; the assertion locks it in.
    for (const r of rows) expect(r.tenantId).toBe(TENANT);
  });

  it("queries TenantUsers scoped to the tenantId (multi-tenant isolation)", async () => {
    findManyMock.mockResolvedValue([] as MemberRow[]);
    await createHandoffNotifications({
      tenantId: TENANT,
      conversationId: CONV,
      reason: "LOW_CONFIDENCE",
      context: { customerMessage: "Hi", channel: "widget" },
    });
    expect(findManyMock).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      select: { userId: true, role: true, permissions: true },
    });
  });
});
