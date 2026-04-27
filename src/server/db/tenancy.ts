import "server-only";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./client";

/**
 * Multi-tenant DB helpers. All app code that touches Tenant / TenantUser /
 * User-routing data goes through this module — never raw Prisma in pages or
 * actions, per CLAUDE.md §3.
 */

export type RoutingUser = {
  id: string;
  email: string | null;
  lastUsedTenant: { id: string; slug: string } | null;
  memberships: Array<{
    tenantId: string;
    role: Role;
    tenant: { id: string; slug: string; name: string };
  }>;
};

/**
 * One-shot fetch used by /post-auth and the workspace switcher: returns the
 * user with their last-used tenant pointer plus all memberships, sorted by
 * join order. Returns null if the user record vanished (signed-out edge case).
 */
export async function getRoutingUser(userId: string): Promise<RoutingUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      lastUsedTenant: { select: { id: true, slug: true } },
      tenants: {
        select: {
          tenantId: true,
          role: true,
          tenant: { select: { id: true, slug: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    lastUsedTenant: user.lastUsedTenant,
    memberships: user.tenants,
  };
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const existing = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  return existing === null;
}

/**
 * Atomically create a tenant, attach the caller as OWNER, and point their
 * lastUsedTenantId at it. Throws on slug collision (Prisma P2002 unique
 * violation) so the caller can surface a friendly message.
 */
export async function createTenantWithOwner(args: {
  userId: string;
  name: string;
  slug: string;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const tenant = await tx.tenant.create({
      data: { name: args.name, slug: args.slug },
      select: { id: true, slug: true, name: true },
    });
    await tx.tenantUser.create({
      data: { tenantId: tenant.id, userId: args.userId, role: "OWNER" },
    });
    await tx.user.update({
      where: { id: args.userId },
      data: { lastUsedTenantId: tenant.id },
    });
    return tenant;
  });
}

/**
 * Update the user's "last-used workspace" pointer. No-op if the user isn't a
 * member of that tenant — never trust the slug from the URL alone.
 */
export async function setLastUsedTenant(args: {
  userId: string;
  tenantId: string;
}): Promise<void> {
  const member = await prisma.tenantUser.findUnique({
    where: { tenantId_userId: { tenantId: args.tenantId, userId: args.userId } },
    select: { id: true },
  });
  if (!member) return;
  await prisma.user.update({
    where: { id: args.userId },
    data: { lastUsedTenantId: args.tenantId },
  });
}

export type TenantMember = {
  id: string;
  role: Role;
  joinedAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
};

/**
 * List all members of a tenant. Sort: OWNERs first, then by join date so the
 * earliest collaborators float to the top — a stable order that's friendlier
 * than alphabetical when teams are small.
 */
export async function listTenantMembers(
  tenantId: string,
): Promise<TenantMember[]> {
  const rows = await prisma.tenantUser.findMany({
    where: { tenantId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  // Pull OWNERs to the top while preserving join order within each role.
  const owners = rows.filter((r) => r.role === "OWNER");
  const rest = rows.filter((r) => r.role !== "OWNER");
  return [...owners, ...rest].map((r) => ({
    id: r.id,
    role: r.role,
    joinedAt: r.createdAt,
    user: r.user,
  }));
}

export async function updateTenantName(args: {
  tenantId: string;
  name: string;
}): Promise<void> {
  await prisma.tenant.update({
    where: { id: args.tenantId },
    data: { name: args.name },
  });
}
