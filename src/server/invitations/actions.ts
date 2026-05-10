"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { auth } from "@/server/auth";
import {
  PERMISSION_SLUGS,
  ROLE_PRESETS,
  isPermissionSlug,
  type PermissionSlug,
} from "@/lib/permissions";
import { prisma } from "@/server/db/client";
import {
  changeMemberRole as dbChangeMemberRole,
  countOwners,
  removeMember as dbRemoveMember,
} from "@/server/db/tenancy";
import {
  cancelInvitation,
  cancelPendingInvitationsForEmail,
  createInvitation,
  extendInvitationExpiry,
  findInvitationByToken,
  inviterDisplayName,
  markInvitationExpiredIfNeeded,
} from "@/server/db/invitations";
import { sendEmail } from "@/server/integrations/email/resend";
import { invitationEmail } from "@/server/integrations/email/templates/invitation";
import { requireTenantContext } from "@/server/tenancy/context";

/**
 * Server Actions for the invitation + member-management surfaces.
 *
 * Trust boundaries:
 *   - inviteEmployeeAction / cancel / resend          → ADMIN-floor + members:edit
 *   - changeMemberRoleAction / removeMemberAction     → OWNER-only
 *   - acceptInvitationAction                          → session-authenticated;
 *                                                       trust hangs on the token
 *
 * Member roster updates revalidate /settings/members so the page picks up
 * fresh pending / member counts without a manual refresh.
 */

const ROLE_VALUES = ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const;
const roleSchema = z.enum(ROLE_VALUES);

const permissionsSchema = z
  .array(z.string())
  .max(PERMISSION_SLUGS.length)
  .transform((arr) =>
    arr.filter((s): s is PermissionSlug => isPermissionSlug(s)),
  );

const inviteInputSchema = z.object({
  tenantSlug: z.string().trim().min(1),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address."),
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  role: roleSchema,
  permissions: permissionsSchema,
});

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

function inviteAcceptUrl(token: string): string {
  return `${APP_URL.replace(/\/$/, "")}/invitations/${token}`;
}

export type InviteEmployeeResult =
  | { ok: true; invitationId: string }
  | { ok: false; error: string };

/**
 * Create an invitation, cancel any prior PENDING for the same
 * (email, tenantId) pair (Q2 rule), and send the email. ADMIN-floor;
 * ADMIN can invite any role EXCEPT OWNER (only OWNER can promote
 * another user to OWNER). Email failures are logged but do not roll
 * back the DB write — admin can resend manually from the pending list.
 */
export async function inviteEmployeeAction(args: {
  tenantSlug: string;
  email: string;
  name?: string;
  role: Role;
  permissions: string[];
}): Promise<InviteEmployeeResult> {
  const parsed = inviteInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid invitation",
    };
  }
  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "ADMIN",
    requiredPermission: "members:edit",
  });

  // Only OWNER can grant OWNER role. ADMIN inviting OWNER is rejected
  // server-side even though the UI hides the option.
  if (parsed.data.role === "OWNER" && ctx.membership.role !== "OWNER") {
    return { ok: false, error: "Only an OWNER can invite another OWNER." };
  }

  // Don't let an admin invite someone who's already a member of this
  // tenant. The check is by email since user signup might post-date the
  // invite — we still want to block re-inviting an existing teammate.
  const existing = await prisma.tenantUser.findFirst({
    where: {
      tenantId: ctx.tenant.id,
      user: { email: parsed.data.email },
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "That email is already a member." };
  }

  // Q2 rule: cancel prior PENDING before creating a new one. Same-email
  // re-invites get a fresh token; old links become dead.
  await cancelPendingInvitationsForEmail({
    tenantId: ctx.tenant.id,
    email: parsed.data.email,
  });

  const invitation = await createInvitation({
    tenantId: ctx.tenant.id,
    email: parsed.data.email,
    name: parsed.data.name,
    role: parsed.data.role,
    permissions: parsed.data.permissions,
    invitedBy: ctx.user.id,
  });

  // Need the token for the URL — re-read it via findInvitationByToken-
  // style lookup, but createInvitation already has it. Pull from db
  // directly to keep the action focused.
  const tokenRow = await prisma.invitation.findUnique({
    where: { id: invitation.id },
    select: { token: true },
  });
  if (!tokenRow) {
    return { ok: false, error: "Invitation created but lookup failed." };
  }

  const rendered = invitationEmail({
    inviteUrl: inviteAcceptUrl(tokenRow.token),
    tenantName: ctx.tenant.name,
    inviterName: inviterDisplayName({
      name: ctx.user.name,
      email: ctx.user.email,
    }),
    role: parsed.data.role,
    inviteeName: parsed.data.name,
  });
  const sendResult = await sendEmail({
    to: parsed.data.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (!sendResult.ok) {
    console.error(
      `[invitations] email failed for invitation=${invitation.id}: ${sendResult.error}`,
    );
  }

  revalidatePath(`/${parsed.data.tenantSlug}/settings/members`);
  return { ok: true, invitationId: invitation.id };
}

const tenantInvitationInputSchema = z.object({
  tenantSlug: z.string().trim().min(1),
  invitationId: z.string().trim().min(1),
});

export async function cancelInvitationAction(args: {
  tenantSlug: string;
  invitationId: string;
}): Promise<{ ok: true }> {
  const parsed = tenantInvitationInputSchema.parse(args);
  const ctx = await requireTenantContext(parsed.tenantSlug, {
    minRole: "ADMIN",
    requiredPermission: "members:edit",
  });
  await cancelInvitation({
    invitationId: parsed.invitationId,
    tenantId: ctx.tenant.id,
  });
  revalidatePath(`/${parsed.tenantSlug}/settings/members`);
  return { ok: true };
}

export type ResendInvitationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Re-send the email and bump expiresAt by another 7 days. The token is
 * unchanged — recipients with the old link still see a working invite,
 * just with more time on the clock.
 */
export async function resendInvitationAction(args: {
  tenantSlug: string;
  invitationId: string;
}): Promise<ResendInvitationResult> {
  const parsed = tenantInvitationInputSchema.parse(args);
  const ctx = await requireTenantContext(parsed.tenantSlug, {
    minRole: "ADMIN",
    requiredPermission: "members:edit",
  });
  const updated = await extendInvitationExpiry({
    invitationId: parsed.invitationId,
    tenantId: ctx.tenant.id,
  });
  if (!updated) {
    return {
      ok: false,
      error: "This invitation can't be resent (cancelled, accepted, or expired).",
    };
  }
  const tokenRow = await prisma.invitation.findUnique({
    where: { id: parsed.invitationId },
    select: { token: true },
  });
  if (!tokenRow) {
    return { ok: false, error: "Invitation lookup failed." };
  }
  const rendered = invitationEmail({
    inviteUrl: inviteAcceptUrl(tokenRow.token),
    tenantName: ctx.tenant.name,
    inviterName: inviterDisplayName({
      name: ctx.user.name,
      email: ctx.user.email,
    }),
    role: updated.role,
    inviteeName: updated.name,
  });
  const sendResult = await sendEmail({
    to: updated.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (!sendResult.ok) {
    console.error(
      `[invitations] resend email failed for invitation=${parsed.invitationId}: ${sendResult.error}`,
    );
  }
  revalidatePath(`/${parsed.tenantSlug}/settings/members`);
  return { ok: true };
}

const changeRoleInputSchema = z.object({
  tenantSlug: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  role: roleSchema,
  permissions: permissionsSchema,
});

export type ChangeMemberRoleResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Change a member's role + permissions. OWNER-only. Guards:
 *   - Cannot demote the LAST OWNER (would orphan the tenant).
 *   - Cannot change your own role (you'd lock yourself out of this UI).
 */
export async function changeMemberRoleAction(args: {
  tenantSlug: string;
  userId: string;
  role: Role;
  permissions: string[];
}): Promise<ChangeMemberRoleResult> {
  const parsed = changeRoleInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "OWNER",
  });

  if (parsed.data.userId === ctx.user.id) {
    return {
      ok: false,
      error:
        "You can't change your own role here. Ask another OWNER to do it.",
    };
  }

  // Last-OWNER guard: if the target is currently OWNER and the new role
  // isn't OWNER, only allow the change if at least one other OWNER
  // exists.
  if (parsed.data.role !== "OWNER") {
    const target = await prisma.tenantUser.findFirst({
      where: { tenantId: ctx.tenant.id, userId: parsed.data.userId },
      select: { role: true },
    });
    if (target?.role === "OWNER") {
      const owners = await countOwners(ctx.tenant.id);
      if (owners <= 1) {
        return {
          ok: false,
          error: "Can't demote the only OWNER — promote someone else first.",
        };
      }
    }
  }

  const result = await dbChangeMemberRole({
    tenantId: ctx.tenant.id,
    userId: parsed.data.userId,
    role: parsed.data.role,
    permissions: parsed.data.permissions,
  });
  if (result.count === 0) {
    return { ok: false, error: "Member not found." };
  }
  revalidatePath(`/${parsed.data.tenantSlug}/settings/members`);
  return { ok: true };
}

const removeMemberInputSchema = z.object({
  tenantSlug: z.string().trim().min(1),
  userId: z.string().trim().min(1),
});

export type RemoveMemberResult = { ok: true } | { ok: false; error: string };

/**
 * Remove a member from a tenant. OWNER-only. Guards: can't remove
 * yourself, can't remove the last OWNER.
 */
export async function removeMemberAction(args: {
  tenantSlug: string;
  userId: string;
}): Promise<RemoveMemberResult> {
  const parsed = removeMemberInputSchema.parse(args);
  const ctx = await requireTenantContext(parsed.tenantSlug, {
    minRole: "OWNER",
  });

  if (parsed.userId === ctx.user.id) {
    return {
      ok: false,
      error: "You can't remove yourself here. Transfer ownership first.",
    };
  }

  const target = await prisma.tenantUser.findFirst({
    where: { tenantId: ctx.tenant.id, userId: parsed.userId },
    select: { role: true },
  });
  if (!target) {
    return { ok: false, error: "Member not found." };
  }
  if (target.role === "OWNER") {
    const owners = await countOwners(ctx.tenant.id);
    if (owners <= 1) {
      return {
        ok: false,
        error: "Can't remove the only OWNER — transfer ownership first.",
      };
    }
  }

  const result = await dbRemoveMember({
    tenantId: ctx.tenant.id,
    userId: parsed.userId,
  });
  if (result.count === 0) {
    return { ok: false, error: "Member not found." };
  }
  revalidatePath(`/${parsed.tenantSlug}/settings/members`);
  return { ok: true };
}

const acceptInvitationInputSchema = z.object({
  token: z.string().trim().min(1).max(128),
});

export type AcceptInvitationResult =
  | { ok: true; tenantSlug: string }
  | { ok: false; error: string };

/**
 * Accept an invitation. Caller must already be signed in with the email
 * the invitation was sent to. The acceptance flow lives in the
 * `/invitations/[token]` page — unauthenticated users land on a sign-in
 * card there, then are redirected back here once authed.
 *
 * On success: creates / updates the TenantUser row, marks the invitation
 * accepted, and (via the redirect on the caller side) sends the user to
 * `/<slug>/dashboard`. Returns an error if any guard fails — never
 * surfaces token contents to logs.
 */
export async function acceptInvitationAction(args: {
  token: string;
}): Promise<AcceptInvitationResult> {
  const parsed = acceptInvitationInputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: "Invalid invitation link." };
  }
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: "Sign in to accept this invitation." };
  }

  const invite = await findInvitationByToken(parsed.data.token);
  if (!invite) {
    return { ok: false, error: "Invalid invitation link." };
  }

  const effectiveStatus = await markInvitationExpiredIfNeeded({
    invitationId: invite.id,
    expiresAt: invite.expiresAt,
    status: invite.status,
  });
  if (effectiveStatus !== "PENDING") {
    return {
      ok: false,
      error:
        effectiveStatus === "EXPIRED"
          ? "This invitation has expired."
          : "This invitation has already been used or cancelled.",
    };
  }

  // Email must match (case-insensitive) the address the invite was
  // sent to. Mismatch → fail-soft: tell the user to sign out and try
  // again. We don't auto-add a user with a different email; that's a
  // separate invite.
  if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return {
      ok: false,
      error: `This invitation is for ${invite.email}. Sign out and try again with that address.`,
    };
  }

  // Acceptance write — done in a transaction so a crashed action can't
  // leave a TenantUser without flipping the invitation, or vice versa.
  // The slug filter on permissions is defense-in-depth: storing a stale
  // slug from a future deleted-permission row would silently grant
  // nothing anyway, but cleaning here keeps DB state tidy.
  const cleanPermissions = invite.permissions.filter(isPermissionSlug);
  const fallbackPermissions =
    cleanPermissions.length === 0 ? [...ROLE_PRESETS[invite.role]] : cleanPermissions;
  await prisma.$transaction([
    prisma.tenantUser.upsert({
      where: {
        tenantId_userId: {
          tenantId: invite.tenantId,
          userId: session.user.id,
        },
      },
      create: {
        tenantId: invite.tenantId,
        userId: session.user.id,
        role: invite.role,
        permissions: fallbackPermissions,
      },
      update: {
        role: invite.role,
        permissions: fallbackPermissions,
      },
    }),
    prisma.invitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { lastUsedTenantId: invite.tenantId },
    }),
  ]);

  revalidatePath(`/${invite.tenant.slug}/settings/members`);
  return { ok: true, tenantSlug: invite.tenant.slug };
}

/**
 * Convenience wrapper used by the acceptance page after auto-accept
 * succeeds — issues the post-auth redirect to the freshly-joined
 * tenant's dashboard. Pulled out so the page component stays a thin
 * server-rendered shell.
 */
export async function acceptInvitationAndRedirect(token: string): Promise<never> {
  const result = await acceptInvitationAction({ token });
  if (result.ok) {
    redirect(`/${result.tenantSlug}/dashboard`);
  }
  // On failure, throw — the page-level catch surfaces the message in
  // the error state UI. We intentionally don't redirect to /login on
  // most failures (user is already logged in; the page will render the
  // "wrong email" / "expired" message).
  throw new Error(result.error);
}

/**
 * Marker re-exports so callers don't have to know the internal helper
 * locations. The action-state shapes live here; the discriminated
 * unions return from each action above.
 */
// (Each action returns its own result shape — no shared state needed.)

/**
 * Calls used by tests that need to import the constants at top-level.
 * Not part of the runtime API.
 */
export type { Role };
