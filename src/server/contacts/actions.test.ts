import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ContactsDbModule from "@/server/db/contacts";

// Hoisted mocks: requireTenantContext is the trust boundary every action
// crosses; mocking it lets us assert role enforcement deterministically.
const requireTenantContextMock = vi.hoisted(() =>
  vi.fn<
    (
      slug: string,
      opts?: { minRole?: "OWNER" | "ADMIN" | "AGENT" | "VIEWER" },
    ) => Promise<{
      user: { id: string };
      tenant: { id: string; slug: string };
      membership: { role: "OWNER" };
    }>
  >(),
);
vi.mock("@/server/tenancy/context", () => ({
  requireTenantContext: requireTenantContextMock,
}));

// db/contacts is the persistence boundary; mock its CRUD so we test the
// action wiring (parse + role check + delegate + revalidate) not the SQL.
const createContactMock = vi.hoisted(() => vi.fn());
const updateContactMock = vi.hoisted(() => vi.fn());
const deleteContactMock = vi.hoisted(() => vi.fn());
const listContactsMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/db/contacts", async () => {
  // Re-export the real Zod schema so input parsing happens against the
  // actual validator (this is part of the contract the action enforces).
  const real = await vi.importActual<typeof ContactsDbModule>(
    "@/server/db/contacts",
  );
  return {
    ...real,
    createContact: createContactMock,
    updateContact: updateContactMock,
    deleteContact: deleteContactMock,
    listContactsForTenant: listContactsMock,
  };
});

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const {
  createContactAction,
  updateContactAction,
  deleteContactAction,
  listContacts,
} = await import("./actions");

const SLUG = "wbp";
const TENANT_ID = "tenant_wbp";

beforeEach(() => {
  requireTenantContextMock.mockReset();
  createContactMock.mockReset();
  updateContactMock.mockReset();
  deleteContactMock.mockReset();
  listContactsMock.mockReset();
  revalidatePathMock.mockReset();

  requireTenantContextMock.mockResolvedValue({
    user: { id: "user_1" },
    tenant: { id: TENANT_ID, slug: SLUG },
    membership: { role: "OWNER" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("contacts actions — role enforcement", () => {
  it("createContactAction requires OWNER role", async () => {
    createContactMock.mockResolvedValue({
      id: "c1",
      name: "Sales",
      phone: "1",
      email: null,
      role: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createContactAction({
      tenantSlug: SLUG,
      input: { name: "Sales", phone: "0559 533 698" },
    });
    expect(requireTenantContextMock).toHaveBeenCalledWith(SLUG, { minRole: "OWNER" });
  });

  it("updateContactAction requires OWNER role", async () => {
    updateContactMock.mockResolvedValue({
      id: "c1",
      name: "Sales",
      phone: "1",
      email: null,
      role: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await updateContactAction({
      tenantSlug: SLUG,
      contactId: "c1",
      input: { name: "Sales", phone: "0559 533 698" },
    });
    expect(requireTenantContextMock).toHaveBeenCalledWith(SLUG, { minRole: "OWNER" });
  });

  it("deleteContactAction requires OWNER role", async () => {
    deleteContactMock.mockResolvedValue(undefined);
    await deleteContactAction({ tenantSlug: SLUG, contactId: "c1" });
    expect(requireTenantContextMock).toHaveBeenCalledWith(SLUG, { minRole: "OWNER" });
  });

  it("listContacts is readable by VIEWER (read-only floor)", async () => {
    listContactsMock.mockResolvedValue([]);
    await listContacts(SLUG);
    expect(requireTenantContextMock).toHaveBeenCalledWith(SLUG, { minRole: "VIEWER" });
  });
});

describe("contacts actions — tenant scoping", () => {
  it("passes the resolved tenantId from requireTenantContext, never the slug", async () => {
    createContactMock.mockResolvedValue({
      id: "c1",
      name: "Sales",
      phone: "1",
      email: null,
      role: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createContactAction({
      tenantSlug: SLUG,
      input: { name: "Sales", phone: "0559 533 698" },
    });
    const args = createContactMock.mock.calls[0]?.[0] as {
      tenantId: string;
    };
    expect(args.tenantId).toBe(TENANT_ID);
    // The slug must NOT have been passed through as the tenant identifier.
    expect(args.tenantId).not.toBe(SLUG);
  });

  it("scopes update by the resolved tenantId", async () => {
    updateContactMock.mockResolvedValue({
      id: "c1",
      name: "Sales",
      phone: "1",
      email: null,
      role: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await updateContactAction({
      tenantSlug: SLUG,
      contactId: "c1",
      input: { name: "Sales", phone: "0559 533 698" },
    });
    const args = updateContactMock.mock.calls[0]?.[0] as {
      tenantId: string;
      contactId: string;
    };
    expect(args.tenantId).toBe(TENANT_ID);
    expect(args.contactId).toBe("c1");
  });

  it("scopes delete by the resolved tenantId", async () => {
    deleteContactMock.mockResolvedValue(undefined);
    await deleteContactAction({ tenantSlug: SLUG, contactId: "c1" });
    const args = deleteContactMock.mock.calls[0]?.[0] as {
      tenantId: string;
      contactId: string;
    };
    expect(args.tenantId).toBe(TENANT_ID);
    expect(args.contactId).toBe("c1");
  });
});

describe("contacts actions — input validation", () => {
  it("rejects an input that has neither phone nor email (at-least-one rule)", async () => {
    await expect(
      createContactAction({
        tenantSlug: SLUG,
        input: { name: "Just a name", phone: undefined, email: undefined },
      }),
    ).rejects.toThrow();
    expect(createContactMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email format", async () => {
    await expect(
      createContactAction({
        tenantSlug: SLUG,
        input: { name: "Sales", email: "not-an-email" },
      }),
    ).rejects.toThrow();
    expect(createContactMock).not.toHaveBeenCalled();
  });

  it("accepts a contact with only a phone", async () => {
    createContactMock.mockResolvedValue({
      id: "c1",
      name: "Sales",
      phone: "0559 533 698",
      email: null,
      role: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createContactAction({
      tenantSlug: SLUG,
      input: { name: "Sales", phone: "0559 533 698" },
    });
    expect(createContactMock).toHaveBeenCalled();
  });

  it("accepts a contact with only an email", async () => {
    createContactMock.mockResolvedValue({
      id: "c2",
      name: "Support",
      phone: null,
      email: "support@example.test",
      role: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createContactAction({
      tenantSlug: SLUG,
      input: { name: "Support", email: "support@example.test" },
    });
    expect(createContactMock).toHaveBeenCalled();
  });
});

describe("contacts actions — revalidation", () => {
  it("revalidates /:slug/contacts after create", async () => {
    createContactMock.mockResolvedValue({
      id: "c1",
      name: "Sales",
      phone: "1",
      email: null,
      role: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createContactAction({
      tenantSlug: SLUG,
      input: { name: "Sales", phone: "0559 533 698" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/${SLUG}/contacts`);
  });

  it("revalidates after delete", async () => {
    deleteContactMock.mockResolvedValue(undefined);
    await deleteContactAction({ tenantSlug: SLUG, contactId: "c1" });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/${SLUG}/contacts`);
  });
});
