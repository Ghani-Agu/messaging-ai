import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Plan, Prisma, Role } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import {
  getEffectivePermissions,
  type PermissionSlug,
} from "@/lib/permissions";

/**
 * Per-request tenant context. Every authenticated, tenant-scoped page and
 * server action resolves this once at the start. The `tenantId` we use in
 * subsequent queries always comes from the membership row verified here —
 * never from a client-provided field. CLAUDE.md hard rule.
 */
export type TenantContext = {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
    isSuperAdmin: boolean;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    accentColor: string | null;
    plan: Plan;
    settings: Prisma.JsonValue;
  };
  membership: {
    role: Role;
    /**
     * Permission slugs the member effectively has. For OWNER this is the
     * full PERMISSION_SLUGS list regardless of what's persisted; for
     * non-OWNER it's the stored TenantUser.permissions filtered to known
     * slugs. Always non-null; defaults to [] for legacy rows that
     * predate the migration backfill.
     */
    permissions: PermissionSlug[];
  };
};

export class PermissionDeniedError extends Error {
  readonly required: PermissionSlug;
  readonly role: Role;
  constructor(required: PermissionSlug, role: Role) {
    super(`Permission denied: requires ${required}; role=${role}`);
    this.name = "PermissionDeniedError";
    this.required = required;
    this.role = role;
  }
}

/**
 * Single source of truth for role precedence. Higher rank ⇒ broader
 * authority. Pages and components that gate UI affordances import this
 * directly so they never drift from `requireTenantContext`'s server-side
 * check.
 */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  AGENT: 2,
  VIEWER: 1,
};

/**
 * Thrown when a user has a valid membership but their role doesn't meet the
 * required minimum for the action. The (app) error boundary renders this as
 * a styled 403; uncaught here, Next.js falls back to its generic error page.
 */
export class ForbiddenError extends Error {
  readonly required: Role;
  readonly actual: Role;
  constructor(required: Role, actual: Role) {
    super(`Forbidden: requires ${required}; have ${actual}`);
    this.name = "ForbiddenError";
    this.required = required;
    this.actual = actual;
  }
}

/**
 * Internal cached resolver. React's cache() memoizes the lookup for the
 * lifetime of a single request, so multiple components / actions on the
 * same page only hit Postgres once. Throws `notFound()` when the user
 * isn't a member — opaque 404 keeps tenant slugs unenumerable.
 */
const resolveContext = cache(async (slug: string): Promise<TenantContext> => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=/${encodeURIComponent(slug)}/dashboard`);
  }

  const row = await prisma.tenantUser.findFirst({
    where: {
      userId: session.user.id,
      tenant: { slug },
    },
    select: {
      role: true,
      permissions: true,
      tenant: {
        select: {
          id: true,
          slug: true,
          name: true,
          accentColor: true,
          plan: true,
          settings: true,
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          isSuperAdmin: true,
        },
      },
    },
  });

  if (!row) {
    notFound();
  }

  return {
    user: row.user,
    tenant: row.tenant,
    membership: {
      role: row.role,
      permissions: getEffectivePermissions({
        role: row.role,
        permissions: row.permissions,
      }),
    },
  };
});

/**
 * Resolve the tenant context for `slug` from the URL. Use this in Server
 * Components (typically in `(app)/[tenantSlug]/layout.tsx`) and any read-only
 * server action.
 *
 * Side-effects:
 * - Redirects to /login if no session.
 * - Calls notFound() if the user isn't a member of the tenant.
 */
export async function getTenantContext(slug: string): Promise<TenantContext> {
  return resolveContext(slug);
}

/**
 * Same as getTenantContext, plus optional role floor + permission check.
 * Use in mutating Server Actions or on routes requiring elevated roles /
 * specific page permissions.
 *
 * Order of checks:
 *   1. resolveContext (auth + membership)
 *   2. minRole — throws ForbiddenError when the role rank falls short.
 *   3. requiredPermission — OWNER always passes; otherwise the user's
 *      effective permission list must contain the slug. Throws
 *      PermissionDeniedError when missing.
 *
 * Both checks are independent: a route can require ADMIN-floor AND a
 * specific edit permission. OWNER bypasses requiredPermission as a
 * defense-in-depth measure (a deleted-from-list slug never locks the
 * OWNER out of their own tenant).
 */
export async function requireTenantContext(
  slug: string,
  options: { minRole?: Role; requiredPermission?: PermissionSlug } = {},
): Promise<TenantContext> {
  const ctx = await resolveContext(slug);
  if (options.minRole) {
    const required = ROLE_RANK[options.minRole];
    const actual = ROLE_RANK[ctx.membership.role];
    if (actual < required) {
      throw new ForbiddenError(options.minRole, ctx.membership.role);
    }
  }
  if (options.requiredPermission) {
    if (
      ctx.membership.role !== "OWNER" &&
      !ctx.membership.permissions.includes(options.requiredPermission)
    ) {
      throw new PermissionDeniedError(
        options.requiredPermission,
        ctx.membership.role,
      );
    }
  }
  return ctx;
}

/**
 * Convenience alias: `requireTenantContext(slug, { minRole: "OWNER" })`.
 * Used by Server Actions that mutate billing-grade or
 * credentials-bearing state (e.g. Live Data Source connect / edit /
 * disconnect). Single chokepoint so the OWNER floor never drifts
 * across actions.
 */
export async function requireOwnerContext(
  slug: string,
): Promise<TenantContext> {
  return requireTenantContext(slug, { minRole: "OWNER" });
}
