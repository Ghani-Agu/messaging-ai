import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks: requireTenantContext is the trust boundary, prisma is
// the persistence boundary, sendEmail is the side-effect. Mock all three
// so we test the action wiring (role enforcement + Zod parse + delegate
// + Q2 rule + last-OWNER guard) without hitting the DB or Resend.

const requireTenantContextMock = vi.hoisted(() =>
  vi.fn<
    (
      slug: string,
      opts?: {
        minRole?: "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
        requiredPermission?: string;
      },
    ) => Promise<{
      user: { id: string; email: string | null; name: string | null };
      tenant: { id: string; slug: string; name: string };
      membership: { role: "OWNER" | "ADMIN" | "AGENT" | "VIEWER"; permissions: string[] };
    }>
  >(),
);
vi.mock("@/server/tenancy/context", () => ({
  requireTenantContext: requireTenantContextMock,
}));

const prismaMock = vi.hoisted(() => ({
  user: { update: vi.fn() },
  tenantUser: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  invitation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ prisma: prismaMock }));

const dbTenancyMock = vi.hoisted(() => ({
  countOwners: vi.fn(),
  addOrUpdateMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock("@/server/db/tenancy", () => dbTenancyMock);

const dbInvitationsMock = vi.hoisted(() => ({
  createInvitation: vi.fn(),
  cancelPendingInvitationsForEmail: vi.fn(),
  findInvitationByToken: vi.fn(),
  markInvitationExpiredIfNeeded: vi.fn(),
  cancelInvitation: vi.fn(),
  extendInvitationExpiry: vi.fn(),
  getInvitationForTenant: vi.fn(),
  markInvitationAccepted: vi.fn(),
  listPendingInvitations: vi.fn(),
  inviterDisplayName: (u: { name: string | null; email: string | null }) =>
    u.name ?? u.email?.split("@")[0] ?? "Someone",
}));
vi.mock("@/server/db/invitations", () => dbInvitationsMock);

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/integrations/email/resend", () => ({
  sendEmail: sendEmailMock,
}));

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({
  auth: authMock,
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const {
  inviteEmployeeAction,
  cancelInvitationAction,
  resendInvitationAction,
  changeMemberRoleAction,
  removeMemberAction,
  acceptInvitationAction,
} = await import("./actions");

const SLUG = "acme";
const TENANT_ID = "tenant_acme";
const OWNER_USER_ID = "user_owner";

function ownerCtx() {
  return {
    user: { id: OWNER_USER_ID, email: "owner@acme.test", name: "Owner" },
    tenant: { id: TENANT_ID, slug: SLUG, name: "Acme" },
    membership: { role: "OWNER" as const, permissions: [] },
  };
}
function adminCtx() {
  return {
    user: { id: "user_admin", email: "admin@acme.test", name: "Admin" },
    tenant: { id: TENANT_ID, slug: SLUG, name: "Acme" },
    membership: { role: "ADMIN" as const, permissions: ["members:edit"] },
  };
}

beforeEach(() => {
  for (const fn of [
    requireTenantContextMock,
    prismaMock.user.update,
    prismaMock.tenantUser.findFirst,
    prismaMock.tenantUser.upsert,
    prismaMock.invitation.findUnique,
    prismaMock.invitation.update,
    prismaMock.$transaction,
    dbTenancyMock.countOwners,
    dbTenancyMock.addOrUpdateMember,
    dbTenancyMock.changeMemberRole,
    dbTenancyMock.removeMember,
    dbInvitationsMock.createInvitation,
    dbInvitationsMock.cancelPendingInvitationsForEmail,
    dbInvitationsMock.findInvitationByToken,
    dbInvitationsMock.markInvitationExpiredIfNeeded,
    dbInvitationsMock.cancelInvitation,
    dbInvitationsMock.extendInvitationExpiry,
    dbInvitationsMock.getInvitationForTenant,
    dbInvitationsMock.markInvitationAccepted,
    sendEmailMock,
    authMock,
  ]) {
    fn.mockReset();
  }
  sendEmailMock.mockResolvedValue({ ok: true });
  prismaMock.$transaction.mockResolvedValue([{}, {}, {}]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("inviteEmployeeAction", () => {
  it("creates a PENDING invitation, cancels prior PENDING, sends email", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue(null);
    dbInvitationsMock.cancelPendingInvitationsForEmail.mockResolvedValue({ count: 0 });
    dbInvitationsMock.createInvitation.mockResolvedValue({
      id: "inv_1",
      email: "lina@acme.test",
      name: null,
      role: "AGENT",
      permissions: ["conversations:view"],
      status: "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      invitedBy: OWNER_USER_ID,
      inviter: { id: OWNER_USER_ID, name: "Owner", email: "owner@acme.test" },
    });
    prismaMock.invitation.findUnique.mockResolvedValue({
      token: "tok_abcdef",
    });

    const result = await inviteEmployeeAction({
      tenantSlug: SLUG,
      email: "Lina@Acme.test",
      role: "AGENT",
      permissions: ["conversations:view"],
    });

    expect(result).toEqual({ ok: true, invitationId: "inv_1" });
    expect(requireTenantContextMock).toHaveBeenCalledWith(SLUG, {
      minRole: "ADMIN",
      requiredPermission: "members:edit",
    });
    // Email lowercased before cancel + create.
    expect(
      dbInvitationsMock.cancelPendingInvitationsForEmail,
    ).toHaveBeenCalledWith({ tenantId: TENANT_ID, email: "lina@acme.test" });
    expect(dbInvitationsMock.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        email: "lina@acme.test",
        role: "AGENT",
        invitedBy: OWNER_USER_ID,
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const email = sendEmailMock.mock.calls[0]![0]!;
    expect(email.to).toBe("lina@acme.test");
    expect(email.html).toContain("/invitations/tok_abcdef");
  });

  it("blocks invite when the email is already a member", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue({ id: "tu_1" });
    const r = await inviteEmployeeAction({
      tenantSlug: SLUG,
      email: "existing@acme.test",
      role: "AGENT",
      permissions: [],
    });
    expect(r).toEqual({ ok: false, error: "That email is already a member." });
    expect(dbInvitationsMock.createInvitation).not.toHaveBeenCalled();
  });

  it("ADMIN cannot invite OWNER role", async () => {
    requireTenantContextMock.mockResolvedValue(adminCtx());
    const r = await inviteEmployeeAction({
      tenantSlug: SLUG,
      email: "new@acme.test",
      role: "OWNER",
      permissions: [],
    });
    expect(r).toEqual({
      ok: false,
      error: "Only an OWNER can invite another OWNER.",
    });
    expect(dbInvitationsMock.createInvitation).not.toHaveBeenCalled();
  });

  it("OWNER can invite OWNER role", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue(null);
    dbInvitationsMock.cancelPendingInvitationsForEmail.mockResolvedValue({ count: 0 });
    dbInvitationsMock.createInvitation.mockResolvedValue({
      id: "inv_2",
      role: "OWNER",
      email: "co-owner@acme.test",
      name: null,
      permissions: [],
      status: "PENDING",
      expiresAt: new Date(),
      acceptedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      invitedBy: OWNER_USER_ID,
      inviter: { id: OWNER_USER_ID, name: "Owner", email: "owner@acme.test" },
    });
    prismaMock.invitation.findUnique.mockResolvedValue({ token: "tok_z" });

    const r = await inviteEmployeeAction({
      tenantSlug: SLUG,
      email: "co-owner@acme.test",
      role: "OWNER",
      permissions: [],
    });
    expect(r.ok).toBe(true);
  });

  it("propagates ForbiddenError from the role/permission check", async () => {
    requireTenantContextMock.mockRejectedValue(new Error("Forbidden"));
    await expect(
      inviteEmployeeAction({
        tenantSlug: SLUG,
        email: "x@y.com",
        role: "AGENT",
        permissions: [],
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("still returns ok if sendEmail fails (DB write already happened)", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue(null);
    dbInvitationsMock.cancelPendingInvitationsForEmail.mockResolvedValue({ count: 0 });
    dbInvitationsMock.createInvitation.mockResolvedValue({
      id: "inv_3",
      email: "x@y.com",
      name: null,
      role: "AGENT",
      permissions: [],
      status: "PENDING",
      expiresAt: new Date(),
      acceptedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      invitedBy: OWNER_USER_ID,
      inviter: { id: OWNER_USER_ID, name: null, email: null },
    });
    prismaMock.invitation.findUnique.mockResolvedValue({ token: "tok" });
    sendEmailMock.mockResolvedValueOnce({ ok: false, error: "ECONNRESET" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await inviteEmployeeAction({
      tenantSlug: SLUG,
      email: "x@y.com",
      role: "AGENT",
      permissions: [],
    });
    expect(r.ok).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("cancelInvitationAction", () => {
  it("requires ADMIN + members:edit and calls cancelInvitation", async () => {
    requireTenantContextMock.mockResolvedValue(adminCtx());
    dbInvitationsMock.cancelInvitation.mockResolvedValue({ count: 1 });
    const r = await cancelInvitationAction({
      tenantSlug: SLUG,
      invitationId: "inv_x",
    });
    expect(r).toEqual({ ok: true });
    expect(requireTenantContextMock).toHaveBeenCalledWith(SLUG, {
      minRole: "ADMIN",
      requiredPermission: "members:edit",
    });
    expect(dbInvitationsMock.cancelInvitation).toHaveBeenCalledWith({
      invitationId: "inv_x",
      tenantId: TENANT_ID,
    });
  });
});

describe("resendInvitationAction", () => {
  it("extends expiry and re-sends the email", async () => {
    requireTenantContextMock.mockResolvedValue(adminCtx());
    const refreshed = {
      id: "inv_y",
      email: "lina@acme.test",
      name: null,
      role: "AGENT" as const,
      permissions: [],
      status: "PENDING" as const,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      invitedBy: OWNER_USER_ID,
      inviter: { id: OWNER_USER_ID, name: "Owner", email: "owner@acme.test" },
    };
    dbInvitationsMock.extendInvitationExpiry.mockResolvedValue(refreshed);
    prismaMock.invitation.findUnique.mockResolvedValue({ token: "tok_refresh" });
    const r = await resendInvitationAction({
      tenantSlug: SLUG,
      invitationId: "inv_y",
    });
    expect(r).toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0]![0]!.html).toContain(
      "/invitations/tok_refresh",
    );
  });

  it("returns error when invitation isn't PENDING", async () => {
    requireTenantContextMock.mockResolvedValue(adminCtx());
    dbInvitationsMock.extendInvitationExpiry.mockResolvedValue(null);
    const r = await resendInvitationAction({
      tenantSlug: SLUG,
      invitationId: "inv_dead",
    });
    expect(r.ok).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("changeMemberRoleAction", () => {
  it("OWNER cannot change their own role", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    const r = await changeMemberRoleAction({
      tenantSlug: SLUG,
      userId: OWNER_USER_ID,
      role: "ADMIN",
      permissions: [],
    });
    expect(r.ok).toBe(false);
    expect(dbTenancyMock.changeMemberRole).not.toHaveBeenCalled();
  });

  it("blocks demoting the last OWNER", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue({ role: "OWNER" });
    dbTenancyMock.countOwners.mockResolvedValue(1);
    const r = await changeMemberRoleAction({
      tenantSlug: SLUG,
      userId: "user_other_owner",
      role: "ADMIN",
      permissions: [],
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining("only OWNER") });
    expect(dbTenancyMock.changeMemberRole).not.toHaveBeenCalled();
  });

  it("allows demoting one OWNER when at least one other OWNER exists", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue({ role: "OWNER" });
    dbTenancyMock.countOwners.mockResolvedValue(2);
    dbTenancyMock.changeMemberRole.mockResolvedValue({ count: 1 });
    const r = await changeMemberRoleAction({
      tenantSlug: SLUG,
      userId: "user_other_owner",
      role: "ADMIN",
      permissions: ["conversations:view"],
    });
    expect(r).toEqual({ ok: true });
    expect(dbTenancyMock.changeMemberRole).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: "user_other_owner",
      role: "ADMIN",
      permissions: ["conversations:view"],
    });
  });

  it("filters unknown permission slugs out of the persisted list", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue({ role: "AGENT" });
    dbTenancyMock.changeMemberRole.mockResolvedValue({ count: 1 });
    await changeMemberRoleAction({
      tenantSlug: SLUG,
      userId: "user_other",
      role: "AGENT",
      permissions: ["conversations:view", "totally-bogus", "products:view"],
    });
    expect(dbTenancyMock.changeMemberRole).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: "user_other",
      role: "AGENT",
      permissions: ["conversations:view", "products:view"],
    });
  });
});

describe("removeMemberAction", () => {
  it("blocks removing yourself", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    const r = await removeMemberAction({
      tenantSlug: SLUG,
      userId: OWNER_USER_ID,
    });
    expect(r.ok).toBe(false);
    expect(dbTenancyMock.removeMember).not.toHaveBeenCalled();
  });

  it("blocks removing the last OWNER", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue({ role: "OWNER" });
    dbTenancyMock.countOwners.mockResolvedValue(1);
    const r = await removeMemberAction({
      tenantSlug: SLUG,
      userId: "user_other_owner",
    });
    expect(r.ok).toBe(false);
    expect(dbTenancyMock.removeMember).not.toHaveBeenCalled();
  });

  it("removes a non-OWNER member", async () => {
    requireTenantContextMock.mockResolvedValue(ownerCtx());
    prismaMock.tenantUser.findFirst.mockResolvedValue({ role: "AGENT" });
    dbTenancyMock.removeMember.mockResolvedValue({ count: 1 });
    const r = await removeMemberAction({
      tenantSlug: SLUG,
      userId: "user_agent",
    });
    expect(r).toEqual({ ok: true });
    expect(dbTenancyMock.removeMember).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: "user_agent",
    });
  });
});

describe("acceptInvitationAction", () => {
  function makeInvite(overrides: Record<string, unknown> = {}) {
    return {
      id: "inv_1",
      token: "tok_abc",
      email: "lina@acme.test",
      tenantId: TENANT_ID,
      role: "AGENT" as const,
      permissions: ["conversations:view"],
      status: "PENDING" as const,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      acceptedAt: null,
      cancelledAt: null,
      tenant: { id: TENANT_ID, slug: SLUG, name: "Acme" },
      inviter: { id: OWNER_USER_ID, name: "Owner", email: "owner@acme.test" },
      ...overrides,
    };
  }

  it("rejects when no session is present", async () => {
    authMock.mockResolvedValue(null);
    const r = await acceptInvitationAction({ token: "tok_abc" });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown tokens", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "x@y.com" } });
    dbInvitationsMock.findInvitationByToken.mockResolvedValue(null);
    const r = await acceptInvitationAction({ token: "tok_unknown" });
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid"),
    });
  });

  it("rejects expired tokens (markInvitationExpiredIfNeeded flips status)", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", email: "lina@acme.test" },
    });
    dbInvitationsMock.findInvitationByToken.mockResolvedValue(makeInvite());
    dbInvitationsMock.markInvitationExpiredIfNeeded.mockResolvedValue(
      "EXPIRED",
    );
    const r = await acceptInvitationAction({ token: "tok_abc" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects already-used invites", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", email: "lina@acme.test" },
    });
    dbInvitationsMock.findInvitationByToken.mockResolvedValue(
      makeInvite({ status: "ACCEPTED" }),
    );
    dbInvitationsMock.markInvitationExpiredIfNeeded.mockResolvedValue(
      "ACCEPTED",
    );
    const r = await acceptInvitationAction({ token: "tok_abc" });
    expect(r.ok).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects email mismatch (case-insensitive)", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", email: "different@acme.test" },
    });
    dbInvitationsMock.findInvitationByToken.mockResolvedValue(makeInvite());
    dbInvitationsMock.markInvitationExpiredIfNeeded.mockResolvedValue(
      "PENDING",
    );
    const r = await acceptInvitationAction({ token: "tok_abc" });
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringContaining("lina@acme.test"),
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("accepts when token + email match: upsert TenantUser, mark accepted, set lastUsedTenant", async () => {
    authMock.mockResolvedValue({
      user: { id: "u_lina", email: "Lina@acme.test" },
    });
    dbInvitationsMock.findInvitationByToken.mockResolvedValue(makeInvite());
    dbInvitationsMock.markInvitationExpiredIfNeeded.mockResolvedValue(
      "PENDING",
    );
    const r = await acceptInvitationAction({ token: "tok_abc" });
    expect(r).toEqual({ ok: true, tenantSlug: SLUG });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
