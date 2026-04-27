import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Plan, Prisma, Role } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

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
  };
};

const ROLE_RANK: Record<Role, number> = {
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
    membership: { role: row.role },
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
 * Same as getTenantContext, plus an optional role floor. Use this in mutating
 * server actions and on routes that require elevated roles (e.g. /billing
 * needing OWNER). Throws `ForbiddenError` when the role is too low.
 */
export async function requireTenantContext(
  slug: string,
  options: { minRole?: Role } = {},
): Promise<TenantContext> {
  const ctx = await resolveContext(slug);
  if (options.minRole) {
    const required = ROLE_RANK[options.minRole];
    const actual = ROLE_RANK[ctx.membership.role];
    if (actual < required) {
      throw new ForbiddenError(options.minRole, ctx.membership.role);
    }
  }
  return ctx;
}
