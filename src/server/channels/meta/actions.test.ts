import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Prisma } from "@prisma/client";

// vi.hoisted gives the connect-client mock a stable shared spy across
// the multiple invocations made by previewFacebookPage and
// confirmFacebookPage.
const {
  validateAccessToken,
  fetchPageDetails,
  subscribeWebhooks,
} = vi.hoisted(() => ({
  validateAccessToken: vi.fn<
    (args: { token: string }) => Promise<{ id: string; name?: string }>
  >(),
  fetchPageDetails: vi.fn<
    (args: { pageId: string; token: string }) => Promise<unknown>
  >(),
  subscribeWebhooks: vi.fn<
    (args: {
      pageId: string;
      token: string;
      subscribedFields: string[];
    }) => Promise<void>
  >(),
}));

vi.mock("@/server/tenancy/context", () => ({
  requireTenantContext: vi.fn(),
  ROLE_RANK: { OWNER: 4, ADMIN: 3, AGENT: 2, VIEWER: 1 },
  ForbiddenError: class extends Error {
    required: string;
    actual: string;
    constructor(required: string, actual: string) {
      super(`Forbidden`);
      this.required = required;
      this.actual = actual;
    }
  },
}));

vi.mock("@/server/db/channels", () => ({
  getMessengerChannel: vi.fn(),
  getInstagramChannel: vi.fn(),
  upsertMessengerChannel: vi.fn(),
  upsertInstagramChannel: vi.fn(),
  decryptMetaCredentials: vi.fn(),
  updateChannelStatus: vi.fn(),
}));

vi.mock("./connect", () => ({
  getMetaConnectClient: vi.fn(() => ({
    validateAccessToken,
    fetchPageDetails,
    subscribeWebhooks,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  confirmFacebookPage,
  disconnectInstagram,
  disconnectMessenger,
  previewFacebookPage,
  testConnection,
  updateMessengerConfig,
} from "./actions";
import {
  confirmMetaConnectInitialState,
  disconnectInitialState,
  previewMetaConnectInitialState,
  testConnectionInitialState,
  configUpdateInitialState,
} from "./state";
import { requireTenantContext, ForbiddenError } from "@/server/tenancy/context";
import {
  decryptMetaCredentials,
  getMessengerChannel,
  updateChannelStatus,
  upsertInstagramChannel,
  upsertMessengerChannel,
} from "@/server/db/channels";

const TENANT_ID = "tnt_test";
const TENANT_SLUG = "acme";
const PAGE_ID = "PAGE_TEST_999";
const IG_USER_ID = "IG_TEST_888";

function adminCtx() {
  return {
    user: { id: "u1", email: null, name: null, image: null, isSuperAdmin: false },
    tenant: { id: TENANT_ID, slug: TENANT_SLUG, name: "Acme", accentColor: null, plan: "STARTER", settings: {} },
    membership: { role: "ADMIN" as const },
  } as never;
}

function agentCtx() {
  return {
    user: { id: "u2", email: null, name: null, image: null, isSuperAdmin: false },
    tenant: { id: TENANT_ID, slug: TENANT_SLUG, name: "Acme", accentColor: null, plan: "STARTER", settings: {} },
    membership: { role: "AGENT" as const },
  } as never;
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: ADMIN context for ADMIN-gated actions.
  vi.mocked(requireTenantContext).mockResolvedValue(adminCtx());
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────────────────

describe("previewFacebookPage", () => {
  it("returns preview shape on token + page lookup success (with IG linked)", async () => {
    validateAccessToken.mockResolvedValue({
      id: PAGE_ID,
      name: "Acme Page",
    });
    fetchPageDetails.mockResolvedValue({
      id: PAGE_ID,
      name: "Acme Page",
      instagram_business_account: { id: IG_USER_ID, username: "acme_official" },
    });

    const result = await previewFacebookPage(
      previewMetaConnectInitialState,
      fd({ tenantSlug: TENANT_SLUG, token: "valid_token" }),
    );

    expect(result.status).toBe("preview");
    if (result.status !== "preview") throw new Error("expected preview");
    expect(result.pageId).toBe(PAGE_ID);
    expect(result.pageName).toBe("Acme Page");
    expect(result.igAvailable).toBe(true);
    expect(result.igUserId).toBe(IG_USER_ID);
    expect(result.igUsername).toBe("acme_official");
  });

  it("returns preview with igAvailable=false when no IG account is linked", async () => {
    validateAccessToken.mockResolvedValue({ id: PAGE_ID, name: "Solo Page" });
    fetchPageDetails.mockResolvedValue({ id: PAGE_ID, name: "Solo Page" });

    const result = await previewFacebookPage(
      previewMetaConnectInitialState,
      fd({ tenantSlug: TENANT_SLUG, token: "valid_token" }),
    );

    expect(result.status).toBe("preview");
    if (result.status !== "preview") throw new Error("expected preview");
    expect(result.igAvailable).toBe(false);
    expect(result.igUserId).toBeUndefined();
  });

  it("returns error when token validation throws", async () => {
    validateAccessToken.mockRejectedValue(
      new Error("HTTP 401 invalid_token"),
    );

    const result = await previewFacebookPage(
      previewMetaConnectInitialState,
      fd({ tenantSlug: TENANT_SLUG, token: "expired_token" }),
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.fieldErrors?.token).toContain("HTTP 401 invalid_token");
    // No DB writes should have happened on a token-validation failure.
    expect(upsertMessengerChannel).not.toHaveBeenCalled();
  });

  it("requires ADMIN role (non-admin context throws ForbiddenError)", async () => {
    vi.mocked(requireTenantContext).mockRejectedValueOnce(
      new ForbiddenError("ADMIN", "AGENT"),
    );

    await expect(
      previewFacebookPage(
        previewMetaConnectInitialState,
        fd({ tenantSlug: TENANT_SLUG, token: "valid_token" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirm — including P2002 cross-tenant collision mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("confirmFacebookPage", () => {
  beforeEach(() => {
    validateAccessToken.mockResolvedValue({ id: PAGE_ID, name: "Acme Page" });
    subscribeWebhooks.mockResolvedValue();
    vi.mocked(upsertMessengerChannel).mockResolvedValue({
      id: "chn_msgr_new",
    } as never);
    vi.mocked(upsertInstagramChannel).mockResolvedValue({
      id: "chn_ig_new",
    } as never);
  });

  it("creates both Messenger and Instagram channels on success", async () => {
    const result = await confirmFacebookPage(
      confirmMetaConnectInitialState,
      fd({
        tenantSlug: TENANT_SLUG,
        token: "valid_token",
        pageId: PAGE_ID,
        pageName: "Acme Page",
        connectMessenger: "on",
        connectInstagram: "on",
        igUserId: IG_USER_ID,
        igUsername: "acme_official",
      }),
    );

    expect(result.status).toBe("connected");
    if (result.status !== "connected") throw new Error("expected connected");
    expect(result.messengerChannelId).toBe("chn_msgr_new");
    expect(result.instagramChannelId).toBe("chn_ig_new");
    expect(subscribeWebhooks).toHaveBeenCalledTimes(1);
  });

  it("re-validates the token on confirm (Gate 1 H8)", async () => {
    await confirmFacebookPage(
      confirmMetaConnectInitialState,
      fd({
        tenantSlug: TENANT_SLUG,
        token: "valid_token",
        pageId: PAGE_ID,
        pageName: "Acme Page",
        connectMessenger: "on",
        connectInstagram: "on",
        igUserId: IG_USER_ID,
        igUsername: "acme_official",
      }),
    );
    // validateAccessToken called once at the top of confirmFacebookPage —
    // even though preview already validated the same token.
    expect(validateAccessToken).toHaveBeenCalledTimes(1);
    expect(validateAccessToken).toHaveBeenCalledWith({ token: "valid_token" });
  });

  it("maps Messenger P2002 collision to scoped fieldErrors.messenger", async () => {
    vi.mocked(upsertMessengerChannel).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("P2002", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const result = await confirmFacebookPage(
      confirmMetaConnectInitialState,
      fd({
        tenantSlug: TENANT_SLUG,
        token: "valid_token",
        pageId: PAGE_ID,
        pageName: "Acme Page",
        connectMessenger: "on",
        // No IG selected — pure messenger collision case.
      }),
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.fieldErrors?.messenger).toContain(
      "already connected to another workspace",
    );
    expect(result.fieldErrors?.instagram).toBeUndefined();
  });

  it("maps Instagram P2002 collision to scoped fieldErrors.instagram (independent of Messenger result, H3)", async () => {
    vi.mocked(upsertInstagramChannel).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("P2002", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const result = await confirmFacebookPage(
      confirmMetaConnectInitialState,
      fd({
        tenantSlug: TENANT_SLUG,
        token: "valid_token",
        pageId: PAGE_ID,
        pageName: "Acme Page",
        connectMessenger: "on",
        connectInstagram: "on",
        igUserId: IG_USER_ID,
        igUsername: "acme_official",
      }),
    );

    // Messenger succeeded, IG collided → status=connected (partial), with
    // the IG collision surfaced in fieldErrors. The two channels are
    // independent (H3) — operator sees what landed.
    expect(result.status).toBe("connected");
    if (result.status !== "connected") throw new Error("expected connected");
    expect(result.messengerChannelId).toBe("chn_msgr_new");
    expect(result.instagramChannelId).toBeUndefined();
  });

  it("returns error when neither channel is selected", async () => {
    const result = await confirmFacebookPage(
      confirmMetaConnectInitialState,
      fd({
        tenantSlug: TENANT_SLUG,
        token: "valid_token",
        pageId: PAGE_ID,
        pageName: "Acme Page",
      }),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.formMessage).toContain("at least one");
    expect(upsertMessengerChannel).not.toHaveBeenCalled();
    expect(upsertInstagramChannel).not.toHaveBeenCalled();
  });

  it("requires ADMIN role", async () => {
    vi.mocked(requireTenantContext).mockRejectedValueOnce(
      new ForbiddenError("ADMIN", "AGENT"),
    );
    await expect(
      confirmFacebookPage(
        confirmMetaConnectInitialState,
        fd({
          tenantSlug: TENANT_SLUG,
          token: "valid_token",
          pageId: PAGE_ID,
          pageName: "Acme Page",
          connectMessenger: "on",
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateMessengerConfig — AGENT role + happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("updateMessengerConfig", () => {
  it("AGENT role can update displayName", async () => {
    vi.mocked(requireTenantContext).mockResolvedValue(agentCtx());
    vi.mocked(getMessengerChannel).mockResolvedValue({
      id: "chn_msgr",
      tenantId: TENANT_ID,
      type: "MESSENGER",
      displayName: "Old Name",
      status: "CONNECTED",
      config: {
        provider: "meta-cloud",
        pageId: PAGE_ID,
        pageName: "Acme Page",
      },
      credentials: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(decryptMetaCredentials).mockReturnValue({
      pageAccessToken: "token",
    });
    vi.mocked(upsertMessengerChannel).mockResolvedValue({
      id: "chn_msgr",
    } as never);

    const result = await updateMessengerConfig(
      configUpdateInitialState,
      fd({ tenantSlug: TENANT_SLUG, displayName: "New Display Name" }),
    );

    expect(result.status).toBe("saved");
    expect(upsertMessengerChannel).toHaveBeenCalledTimes(1);
    const args = vi.mocked(upsertMessengerChannel).mock.calls[0]![0];
    expect(args.config.displayName).toBe("New Display Name");
  });

  it("returns error when no Messenger channel exists", async () => {
    vi.mocked(requireTenantContext).mockResolvedValue(agentCtx());
    vi.mocked(getMessengerChannel).mockResolvedValue(null);

    const result = await updateMessengerConfig(
      configUpdateInitialState,
      fd({ tenantSlug: TENANT_SLUG, displayName: "Anything" }),
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.formMessage).toContain("Connect Messenger first");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// testConnection — calls validateAccessToken, surfaces ok / error
// ─────────────────────────────────────────────────────────────────────────────

describe("testConnection", () => {
  beforeEach(() => {
    vi.mocked(requireTenantContext).mockResolvedValue(agentCtx());
    vi.mocked(getMessengerChannel).mockResolvedValue({
      id: "chn_msgr",
      credentials: { v: 1, iv: "x", tag: "y", ciphertext: "z" },
    } as never);
    vi.mocked(decryptMetaCredentials).mockReturnValue({
      pageAccessToken: "live_token",
    });
  });

  it("returns ok with pageId when validateAccessToken succeeds", async () => {
    validateAccessToken.mockResolvedValue({
      id: PAGE_ID,
      name: "Acme Page",
    });
    const result = await testConnection(
      testConnectionInitialState,
      fd({ tenantSlug: TENANT_SLUG, platform: "messenger" }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.pageId).toBe(PAGE_ID);
    expect(result.pageName).toBe("Acme Page");
  });

  it("returns error message when validateAccessToken throws", async () => {
    validateAccessToken.mockRejectedValue(new Error("HTTP 401 expired"));
    const result = await testConnection(
      testConnectionInitialState,
      fd({ tenantSlug: TENANT_SLUG, platform: "messenger" }),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.message).toContain("HTTP 401 expired");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// disconnect — independent per-platform (H3)
// ─────────────────────────────────────────────────────────────────────────────

describe("disconnect actions", () => {
  it("disconnectMessenger flips status without touching Instagram", async () => {
    vi.mocked(getMessengerChannel).mockResolvedValue({
      id: "chn_msgr",
    } as never);

    const result = await disconnectMessenger(
      disconnectInitialState,
      fd({ tenantSlug: TENANT_SLUG }),
    );

    expect(result.status).toBe("ok");
    expect(updateChannelStatus).toHaveBeenCalledTimes(1);
    expect(updateChannelStatus).toHaveBeenCalledWith(
      TENANT_ID,
      "chn_msgr",
      "DISCONNECTED",
    );
  });

  it("disconnectInstagram requires ADMIN", async () => {
    vi.mocked(requireTenantContext).mockRejectedValueOnce(
      new ForbiddenError("ADMIN", "AGENT"),
    );
    await expect(
      disconnectInstagram(
        disconnectInitialState,
        fd({ tenantSlug: TENANT_SLUG }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
