import "server-only";
import { randomBytes } from "node:crypto";
import type { Invitation, InvitationStatus, Role } from "@prisma/client";
import type { PermissionSlug } from "@/lib/permissions";
import { prisma } from "./client";

/**
 * Invitation DB layer. Tokens are minted here (32 random bytes hex) so the
 * Server Action doesn't need its own crypto import — single chokepoint for
 * the token shape, and tests don't have to mock randomBytes themselves.
 *
 * Token TTL is 7 days. Status lifecycle:
 *
 *   PENDING   ↓                          ↓
 *             ACCEPTED                   CANCELLED
 *             (acceptedAt set)           (cancelledAt set)
 *             ↓
 *             EXPIRED (lazy: set by the next read that observes
 *             expiresAt < now AND status === PENDING)
 *
 * The lazy-expire keeps us off a worker for v1; lookup sites always pass
 * the candidate row through `markInvitationExpiredIfNeeded` before acting
 * on it.
 */

export const INVITATION_TTL_DAYS = 7;
const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

export type InvitationSummary = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  permissions: string[];
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  invitedBy: string;
  inviter: { id: string; name: string | null; email: string | null };
};

function inviteSummary(
  row: Invitation & {
    inviter: { id: string; name: string | null; email: string | null };
  },
): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    permissions: row.permissions,
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    invitedBy: row.invitedBy,
    inviter: row.inviter,
  };
}

/**
 * Create a new invitation row. Caller is responsible for cancelling any
 * prior PENDING invite for the same (email, tenantId) pair before calling
 * — see `cancelPendingInvitationsForEmail`. Email is lowercased on
 * insert.
 */
export async function createInvitation(args: {
  tenantId: string;
  email: string;
  name: string | null;
  role: Role;
  permissions: PermissionSlug[];
  invitedBy: string;
}): Promise<InvitationSummary> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const row = await prisma.invitation.create({
    data: {
      token,
      email: args.email.toLowerCase(),
      name: args.name,
      tenantId: args.tenantId,
      invitedBy: args.invitedBy,
      role: args.role,
      permissions: args.permissions as string[],
      expiresAt,
    },
    include: {
      inviter: { select: { id: true, name: true, email: true } },
    },
  });
  return inviteSummary(row);
}

/**
 * Cancel every PENDING invite for the (email, tenantId) pair. Idempotent —
 * returns the count cancelled. Q2 rule: called before createInvitation
 * inside the action so re-inviting doesn't leave stale tokens valid.
 */
export async function cancelPendingInvitationsForEmail(args: {
  tenantId: string;
  email: string;
}): Promise<{ count: number }> {
  const result = await prisma.invitation.updateMany({
    where: {
      tenantId: args.tenantId,
      email: args.email.toLowerCase(),
      status: "PENDING",
    },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  return { count: result.count };
}

/**
 * Find an invitation by its token. Returns the raw row (incl. token) so
 * the acceptance flow has everything it needs. Caller MUST check
 * status + expiresAt before acting on the row. The token IS sensitive —
 * never log this object.
 */
export async function findInvitationByToken(
  token: string,
): Promise<
  | (Invitation & {
      tenant: { id: string; slug: string; name: string };
      inviter: { id: string; name: string | null; email: string | null };
    })
  | null
> {
  return prisma.invitation.findUnique({
    where: { token },
    include: {
      tenant: { select: { id: true, slug: true, name: true } },
      inviter: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Lazy-expire helper. If the invite is PENDING but past its expiresAt,
 * flip it to EXPIRED in-place and return the updated status. Otherwise
 * return the row's current status unchanged.
 */
export async function markInvitationExpiredIfNeeded(args: {
  invitationId: string;
  expiresAt: Date;
  status: InvitationStatus;
}): Promise<InvitationStatus> {
  if (args.status !== "PENDING") return args.status;
  if (args.expiresAt.getTime() > Date.now()) return args.status;
  await prisma.invitation.update({
    where: { id: args.invitationId },
    data: { status: "EXPIRED" },
  });
  return "EXPIRED";
}

/**
 * Get a single invitation by id, scoped to a tenant. Used by the
 * cancel/resend actions to verify the invite belongs to the caller's
 * tenant before mutating.
 */
export async function getInvitationForTenant(args: {
  invitationId: string;
  tenantId: string;
}): Promise<InvitationSummary | null> {
  const row = await prisma.invitation.findFirst({
    where: { id: args.invitationId, tenantId: args.tenantId },
    include: {
      inviter: { select: { id: true, name: true, email: true } },
    },
  });
  return row ? inviteSummary(row) : null;
}

/**
 * Cancel an invitation (sets status=CANCELLED). Idempotent; rows that
 * aren't PENDING are left alone (returns count=0).
 */
export async function cancelInvitation(args: {
  invitationId: string;
  tenantId: string;
}): Promise<{ count: number }> {
  const result = await prisma.invitation.updateMany({
    where: {
      id: args.invitationId,
      tenantId: args.tenantId,
      status: "PENDING",
    },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  return { count: result.count };
}

/**
 * Bump a PENDING invitation's expiresAt by another TTL window. Returns
 * the updated row (with new token kept stable — same link still works,
 * just gets more time). Returns null if the invitation isn't PENDING
 * (caller surfaces a "not allowed" error).
 */
export async function extendInvitationExpiry(args: {
  invitationId: string;
  tenantId: string;
}): Promise<InvitationSummary | null> {
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const result = await prisma.invitation.updateMany({
    where: {
      id: args.invitationId,
      tenantId: args.tenantId,
      status: "PENDING",
    },
    data: { expiresAt },
  });
  if (result.count === 0) return null;
  // Re-read for inviter include + fresh expiresAt.
  return getInvitationForTenant({
    invitationId: args.invitationId,
    tenantId: args.tenantId,
  });
}

/**
 * Mark an invitation as accepted. Caller must have created the
 * TenantUser row inside the same transaction; this helper is one half
 * of the acceptance write.
 */
export async function markInvitationAccepted(args: {
  invitationId: string;
}): Promise<void> {
  await prisma.invitation.update({
    where: { id: args.invitationId },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
}

/**
 * List PENDING invitations for a tenant. Used by the Members page's
 * "Pending invitations" section. Sorted newest-first so a fresh
 * invite floats to the top.
 */
export async function listPendingInvitations(
  tenantId: string,
): Promise<InvitationSummary[]> {
  const rows = await prisma.invitation.findMany({
    where: { tenantId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      inviter: { select: { id: true, name: true, email: true } },
    },
  });
  return rows.map(inviteSummary);
}

/**
 * Look up the inviter's display string for the email template. Returns
 * "name" if set, else email local-part, else "Someone". Pure helper.
 */
export function inviterDisplayName(inviter: {
  name: string | null;
  email: string | null;
}): string {
  if (inviter.name?.trim()) return inviter.name.trim();
  if (inviter.email) return inviter.email.split("@")[0] ?? inviter.email;
  return "Someone";
}
