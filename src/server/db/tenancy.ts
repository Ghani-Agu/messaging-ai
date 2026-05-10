import "server-only";
import type { Prisma, Role } from "@prisma/client";
import type { AiBehavior } from "@/lib/validators";
import type { PermissionSlug } from "@/lib/permissions";
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
  /** Persisted permissions (stored value, not OWNER-resolved). */
  permissions: string[];
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
      permissions: true,
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
    permissions: r.permissions,
    joinedAt: r.createdAt,
    user: r.user,
  }));
}

/**
 * Count OWNER rows for a tenant. Used by changeMemberRole / removeMember
 * to guard against orphaning a tenant (last-OWNER protection).
 */
export async function countOwners(tenantId: string): Promise<number> {
  return prisma.tenantUser.count({
    where: { tenantId, role: "OWNER" },
  });
}

/**
 * Add an existing User as a member of a tenant with the given role and
 * permission list. Idempotent: if (tenantId, userId) already exists, the
 * existing row is updated in place (role + permissions overwritten).
 * Returns the resulting TenantUser id.
 */
export async function addOrUpdateMember(args: {
  tenantId: string;
  userId: string;
  role: Role;
  permissions: PermissionSlug[];
}): Promise<{ id: string }> {
  const row = await prisma.tenantUser.upsert({
    where: {
      tenantId_userId: { tenantId: args.tenantId, userId: args.userId },
    },
    create: {
      tenantId: args.tenantId,
      userId: args.userId,
      role: args.role,
      permissions: args.permissions as string[],
    },
    update: {
      role: args.role,
      permissions: args.permissions as string[],
    },
    select: { id: true },
  });
  return row;
}

/**
 * Change a member's role and replace their permissions list. Caller is
 * responsible for the last-OWNER and self-demotion guards — this helper
 * just executes the write. Returns the affected row count (0 if the
 * member isn't part of this tenant — caller can surface "not found").
 */
export async function changeMemberRole(args: {
  tenantId: string;
  userId: string;
  role: Role;
  permissions: PermissionSlug[];
}): Promise<{ count: number }> {
  const result = await prisma.tenantUser.updateMany({
    where: { tenantId: args.tenantId, userId: args.userId },
    data: { role: args.role, permissions: args.permissions as string[] },
  });
  return { count: result.count };
}

/**
 * Remove a member from a tenant. Caller checks the last-OWNER + self-
 * removal guards. Returns count (0 if the user wasn't a member).
 */
export async function removeMember(args: {
  tenantId: string;
  userId: string;
}): Promise<{ count: number }> {
  const result = await prisma.tenantUser.deleteMany({
    where: { tenantId: args.tenantId, userId: args.userId },
  });
  return { count: result.count };
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

/**
 * Patch the `aiBehavior` key inside Tenant.settings without clobbering
 * other keys (voiceProfile, brandVoice, businessHours, etc.). Runs in a
 * single transaction so the read-modify-write doesn't race with a
 * parallel voice-profile save on the same tenant.
 */
export async function updateTenantAiBehavior(args: {
  tenantId: string;
  aiBehavior: AiBehavior;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.tenant.findUnique({
      where: { id: args.tenantId },
      select: { settings: true },
    });
    if (!row) throw new Error(`tenant not found: ${args.tenantId}`);
    const base =
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {};
    const next = { ...base, aiBehavior: args.aiBehavior };
    await tx.tenant.update({
      where: { id: args.tenantId },
      data: { settings: next as Prisma.InputJsonValue },
    });
  });
}
