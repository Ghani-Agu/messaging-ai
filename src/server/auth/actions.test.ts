import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks: Prisma, sendEmail, hashPassword, NextAuth signIn / signOut.
// Action logic + role boundary is what we care about; we never hit the real
// DB, the real bcrypt cost factor, or the real Resend API.

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  passwordResetToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ prisma: prismaMock }));

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/integrations/email/resend", () => ({
  sendEmail: sendEmailMock,
}));

const hashPasswordMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/password", () => ({
  hashPassword: hashPasswordMock,
  // Imported indirectly via config.ts → verifyPassword. The actions
  // themselves only need hashPassword.
  verifyPassword: vi.fn(),
}));

const signInMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({
  signIn: signInMock,
  signOut: signOutMock,
}));

// next-auth's top-level entry loads next/server transitively; that
// import isn't resolvable in a pure-node vitest run. Mock to expose
// just the AuthError class the action's catch path narrows on.
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));

const {
  createPasswordResetTokenAction,
  confirmPasswordResetAction,
} = await import("./actions");

const idle = { status: "idle" } as const;

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.append(k, v);
  return f;
}

beforeEach(() => {
  for (const fn of [
    prismaMock.user.findUnique,
    prismaMock.user.update,
    prismaMock.passwordResetToken.create,
    prismaMock.passwordResetToken.findUnique,
    prismaMock.passwordResetToken.update,
    prismaMock.$transaction,
    sendEmailMock,
    hashPasswordMock,
    signInMock,
    signOutMock,
  ]) {
    fn.mockReset();
  }
  prismaMock.$transaction.mockResolvedValue([]);
  hashPasswordMock.mockResolvedValue("$2b$12$mocked-hash");
  sendEmailMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createPasswordResetTokenAction — no info leak", () => {
  it("returns 'sent' for an unknown email and never touches the email or token tables", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await createPasswordResetTokenAction(
      idle,
      fd({ email: "ghost@example.com" }),
    );
    expect(result).toEqual({ status: "sent" });
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns 'sent' for a known email and creates a token + sends the email", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Sam",
      email: "sam@example.com",
    });
    prismaMock.passwordResetToken.create.mockResolvedValue({});

    const result = await createPasswordResetTokenAction(
      idle,
      fd({ email: "sam@example.com" }),
    );

    expect(result).toEqual({ status: "sent" });
    expect(prismaMock.passwordResetToken.create).toHaveBeenCalledTimes(1);
    const tokenArg = prismaMock.passwordResetToken.create.mock.calls[0]![0]!.data;
    // 64 hex chars = 32 random bytes.
    expect(tokenArg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenArg.userId).toBe("u1");
    // Expires ~1 hour in the future.
    const ttl = tokenArg.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(58 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const emailArgs = sendEmailMock.mock.calls[0]![0]!;
    expect(emailArgs.to).toBe("sam@example.com");
    // The reset URL contains the token from the create call.
    expect(emailArgs.html).toContain(`/reset-password/${tokenArg.token}`);
    expect(emailArgs.text).toContain(`/reset-password/${tokenArg.token}`);
  });

  it("still returns 'sent' if sendEmail fails (no info leak, logs the failure)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      name: null,
      email: "sam@example.com",
    });
    prismaMock.passwordResetToken.create.mockResolvedValue({});
    sendEmailMock.mockResolvedValueOnce({ ok: false, error: "ECONNRESET" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await createPasswordResetTokenAction(
      idle,
      fd({ email: "sam@example.com" }),
    );
    expect(result).toEqual({ status: "sent" });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("rejects a malformed email with status=error", async () => {
    const result = await createPasswordResetTokenAction(
      idle,
      fd({ email: "not-an-email" }),
    );
    expect(result.status).toBe("error");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("confirmPasswordResetAction", () => {
  const futureExpiry = new Date(Date.now() + 30 * 60 * 1000);
  const pastExpiry = new Date(Date.now() - 5 * 60 * 1000);

  it("rejects an unknown token with the uniform invalid/expired message", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);
    const result = await confirmPasswordResetAction(
      { status: "idle" },
      fd({ token: "doesnotexist", password: "Valid123abc" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "This reset link is invalid or has expired.",
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: pastExpiry,
      usedAt: null,
    });
    const result = await confirmPasswordResetAction(
      { status: "idle" },
      fd({ token: "abc", password: "Valid123abc" }),
    );
    expect(result.status).toBe("error");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an already-used token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: futureExpiry,
      usedAt: new Date(),
    });
    const result = await confirmPasswordResetAction(
      { status: "idle" },
      fd({ token: "abc", password: "Valid123abc" }),
    );
    expect(result.status).toBe("error");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a weak password (passwordSchema rule violation) before hashing", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: futureExpiry,
      usedAt: null,
    });
    const result = await confirmPasswordResetAction(
      { status: "idle" },
      fd({ token: "abc", password: "short" }),
    );
    expect(result.status).toBe("error");
    expect(hashPasswordMock).not.toHaveBeenCalled();
  });

  it("hashes the password and atomically updates user + marks token used on success", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: futureExpiry,
      usedAt: null,
    });
    prismaMock.$transaction.mockResolvedValueOnce([{}, {}]);

    const result = await confirmPasswordResetAction(
      { status: "idle" },
      fd({ token: "abc", password: "Valid123abc" }),
    );

    expect(result).toEqual({ status: "done" });
    expect(hashPasswordMock).toHaveBeenCalledWith("Valid123abc");
    // Both update calls live inside a single $transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Verifies that user.update and token.update were the operations
    // passed in the transaction array.
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.passwordResetToken.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.update.mock.calls[0]![0]).toEqual({
      where: { id: "u1" },
      data: { passwordHash: "$2b$12$mocked-hash" },
    });
    expect(prismaMock.passwordResetToken.update.mock.calls[0]![0]!.where).toEqual({
      id: "rt1",
    });
  });
});
