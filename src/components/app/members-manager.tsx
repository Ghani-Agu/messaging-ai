"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Loader2, Mail, MoreVertical, RotateCw, Trash2, X } from "lucide-react";
import type { InvitationStatus, Role } from "@prisma/client";
import {
  PERMISSION_GROUPS,
  ROLE_PRESETS,
  labelForPermission,
  type PermissionSlug,
} from "@/lib/permissions";
import {
  cancelInvitationAction,
  changeMemberRoleAction,
  inviteEmployeeAction,
  removeMemberAction,
  resendInvitationAction,
} from "@/server/invitations/actions";
import { RoleBadge } from "./role-badge";
import { cn } from "@/lib/utils";

type MemberRow = {
  id: string;
  userId: string;
  role: Role;
  permissions: string[];
  joinedAt: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type InvitationRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  permissions: string[];
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  inviterName: string | null;
  inviterEmail: string | null;
};

type Banner = { kind: "ok" | "error"; text: string } | null;

export function MembersManager({
  tenantSlug,
  currentUserId,
  currentUserRole,
  members,
  invitations,
}: {
  tenantSlug: string;
  currentUserId: string;
  currentUserRole: Role;
  members: MemberRow[];
  invitations: InvitationRow[];
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberRow | null>(null);
  const [removingMember, setRemovingMember] = useState<MemberRow | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  const canInvite =
    currentUserRole === "OWNER" || currentUserRole === "ADMIN";
  const canEditMembers = currentUserRole === "OWNER";

  function resendInvitation(invitationId: string): void {
    startTransition(async () => {
      try {
        const r = await resendInvitationAction({ tenantSlug, invitationId });
        if (r.ok) setBanner({ kind: "ok", text: "Invitation resent." });
        else setBanner({ kind: "error", text: r.error });
      } catch {
        setBanner({ kind: "error", text: "Failed to resend invitation." });
      }
    });
  }

  function cancelInvitation(invitationId: string): void {
    startTransition(async () => {
      try {
        await cancelInvitationAction({ tenantSlug, invitationId });
        setBanner({ kind: "ok", text: "Invitation cancelled." });
      } catch {
        setBanner({ kind: "error", text: "Failed to cancel invitation." });
      }
    });
  }

  return (
    <div className="space-y-8">
      {banner ? (
        <div
          role={banner.kind === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-4 py-3 text-body-sm",
            banner.kind === "ok"
              ? "border-[color-mix(in_oklab,var(--success)_40%,transparent)] bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]"
              : "border-[color-mix(in_oklab,var(--danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] text-[var(--danger)]",
          )}
        >
          {banner.text}
        </div>
      ) : null}

      {canInvite ? (
        <div className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4">
          <div>
            <p className="text-body-sm font-medium text-[var(--text-primary)]">
              Invite a teammate
            </p>
            <p className="mt-0.5 text-body-sm text-[var(--text-tertiary)]">
              They&apos;ll get an email with a link to join in their assigned role.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-base)] px-4 text-body-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-[var(--accent-hover)]"
          >
            <Mail className="size-3.5" aria-hidden />
            Invite member
          </button>
        </div>
      ) : null}

      {invitations.length > 0 ? (
        <section aria-labelledby="pending-heading">
          <h3
            id="pending-heading"
            className="mb-3 text-body-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]"
          >
            Pending invitations
          </h3>
          <ul
            role="list"
            className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          >
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-[var(--text-primary)]">
                    {inv.email}
                  </p>
                  <p className="mt-0.5 text-body-sm text-[var(--text-tertiary)]">
                    {inv.role.toLowerCase()} · invited{" "}
                    {new Date(inv.createdAt).toLocaleDateString()} · expires{" "}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {canInvite ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => resendInvitation(inv.id)}
                      disabled={pending}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-3 text-caption font-medium text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      <RotateCw className="size-3" aria-hidden />
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelInvitation(inv.id)}
                      disabled={pending}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-3 text-caption font-medium text-[var(--text-tertiary)] hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50"
                    >
                      <X className="size-3" aria-hidden />
                      Cancel
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="members-heading">
        <h3
          id="members-heading"
          className="mb-3 text-body-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]"
        >
          Current members ({members.length})
        </h3>
        <ul
          role="list"
          className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          {members.map((m) => (
            <MemberRowItem
              key={m.id}
              member={m}
              isYou={m.userId === currentUserId}
              canEdit={canEditMembers && m.userId !== currentUserId}
              onEdit={() => setEditingMember(m)}
              onRemove={() => setRemovingMember(m)}
            />
          ))}
        </ul>
      </section>

      {inviteOpen ? (
        <InviteModal
          tenantSlug={tenantSlug}
          currentUserRole={currentUserRole}
          onClose={() => setInviteOpen(false)}
          onSuccess={() => {
            setInviteOpen(false);
            setBanner({ kind: "ok", text: "Invitation sent." });
          }}
        />
      ) : null}

      {editingMember ? (
        <EditMemberModal
          tenantSlug={tenantSlug}
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSuccess={() => {
            setEditingMember(null);
            setBanner({ kind: "ok", text: "Member updated." });
          }}
        />
      ) : null}

      {removingMember ? (
        <RemoveMemberModal
          tenantSlug={tenantSlug}
          member={removingMember}
          onClose={() => setRemovingMember(null)}
          onSuccess={() => {
            setRemovingMember(null);
            setBanner({ kind: "ok", text: "Member removed." });
          }}
        />
      ) : null}
    </div>
  );
}

function MemberRowItem({
  member,
  isYou,
  canEdit,
  onEdit,
  onRemove,
}: {
  member: MemberRow;
  isYou: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const display = member.name?.trim() || member.email?.split("@")[0] || "Unnamed";
  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-body font-medium text-[var(--text-primary)]">
            {display}
          </span>
          {isYou ? (
            <span className="rounded bg-[var(--bg-surface-elevated)] px-1.5 py-0.5 text-caption text-[var(--text-tertiary)]">
              you
            </span>
          ) : null}
        </div>
        {member.email && member.email !== display ? (
          <span className="truncate text-body-sm text-[var(--text-secondary)]">
            {member.email}
          </span>
        ) : null}
      </div>
      <RoleBadge role={member.role} />
      {canEdit ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Member actions"
            className="inline-flex size-8 items-center justify-center rounded-md border border-transparent text-[var(--text-tertiary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
          >
            <MoreVertical className="size-4" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-9 z-10 min-w-[140px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1 shadow-[var(--shadow-md)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
                className="block w-full rounded px-3 py-1.5 text-left text-body-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-overlay)]"
              >
                Edit role
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                className="block w-full rounded px-3 py-1.5 text-left text-body-sm text-[var(--danger)] hover:bg-[var(--bg-surface-overlay)]"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function InviteModal({
  tenantSlug,
  currentUserRole,
  onClose,
  onSuccess,
}: {
  tenantSlug: string;
  currentUserRole: Role;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("AGENT");
  const [permissions, setPermissions] = useState<PermissionSlug[]>([
    ...ROLE_PRESETS.AGENT,
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const availableRoles: Role[] =
    currentUserRole === "OWNER"
      ? ["OWNER", "ADMIN", "AGENT", "VIEWER"]
      : ["ADMIN", "AGENT", "VIEWER"];

  function selectRole(next: Role): void {
    setRole(next);
    setPermissions([...ROLE_PRESETS[next]]);
  }

  function submit(): void {
    setError(null);
    startTransition(async () => {
      try {
        const r = await inviteEmployeeAction({
          tenantSlug,
          email,
          name: name.trim() || undefined,
          role,
          permissions,
        });
        if (r.ok) onSuccess();
        else setError(r.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send invite.");
      }
    });
  }

  return (
    <ModalShell title="Invite a teammate" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            placeholder="teammate@example.com"
            disabled={pending}
            className="block h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]"
          />
        </Field>
        <Field label="Name (optional)">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className="block h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]"
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => selectRole(e.target.value as Role)}
            disabled={pending}
            className="block h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]"
          >
            {availableRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <PermissionsPicker
          role={role}
          permissions={permissions}
          onChange={setPermissions}
          disabled={pending}
        />
        {error ? (
          <p role="alert" className="text-body-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-md border border-[var(--border-subtle)] bg-transparent px-4 text-body-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-default)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !email}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-base)] px-4 text-body-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              "Send invitation"
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function EditMemberModal({
  tenantSlug,
  member,
  onClose,
  onSuccess,
}: {
  tenantSlug: string;
  member: MemberRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [role, setRole] = useState<Role>(member.role);
  const [permissions, setPermissions] = useState<PermissionSlug[]>(
    member.permissions.filter((p): p is PermissionSlug =>
      ROLE_PRESETS.OWNER.includes(p as PermissionSlug),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function selectRole(next: Role): void {
    setRole(next);
    setPermissions([...ROLE_PRESETS[next]]);
  }

  function submit(): void {
    setError(null);
    startTransition(async () => {
      try {
        const r = await changeMemberRoleAction({
          tenantSlug,
          userId: member.userId,
          role,
          permissions,
        });
        if (r.ok) onSuccess();
        else setError(r.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update member.");
      }
    });
  }

  return (
    <ModalShell title={`Edit ${member.name ?? member.email ?? "member"}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => selectRole(e.target.value as Role)}
            disabled={pending}
            className="block h-10 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]"
          >
            <option value="OWNER">OWNER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="AGENT">AGENT</option>
            <option value="VIEWER">VIEWER</option>
          </select>
        </Field>
        <PermissionsPicker
          role={role}
          permissions={permissions}
          onChange={setPermissions}
          disabled={pending}
        />
        {error ? (
          <p role="alert" className="text-body-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-md border border-[var(--border-subtle)] bg-transparent px-4 text-body-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-default)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-base)] px-4 text-body-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function RemoveMemberModal({
  tenantSlug,
  member,
  onClose,
  onSuccess,
}: {
  tenantSlug: string;
  member: MemberRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const display = member.name?.trim() || member.email || "this member";

  function submit(): void {
    setError(null);
    startTransition(async () => {
      try {
        const r = await removeMemberAction({
          tenantSlug,
          userId: member.userId,
        });
        if (r.ok) onSuccess();
        else setError(r.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove member.");
      }
    });
  }

  return (
    <ModalShell title="Remove member?" onClose={onClose}>
      <p className="text-body text-[var(--text-secondary)]">
        Remove <strong className="text-[var(--text-primary)]">{display}</strong>{" "}
        from the workspace? They will lose access immediately.
      </p>
      <p className="mt-2 text-body-sm text-[var(--text-tertiary)]">
        This can&apos;t be undone — invite them again if you change your mind.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-body-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-md border border-[var(--border-subtle)] bg-transparent px-4 text-body-sm font-medium text-[var(--text-secondary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--danger)] px-4 text-body-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Removing…
            </>
          ) : (
            <>
              <Trash2 className="size-3.5" aria-hidden />
              Remove
            </>
          )}
        </button>
      </div>
    </ModalShell>
  );
}

function PermissionsPicker({
  role,
  permissions,
  onChange,
  disabled,
}: {
  role: Role;
  permissions: PermissionSlug[];
  onChange: (next: PermissionSlug[]) => void;
  disabled: boolean;
}) {
  const set = useMemo(() => new Set(permissions), [permissions]);

  function toggle(slug: PermissionSlug, on: boolean): void {
    const next = new Set(set);
    if (on) next.add(slug);
    else next.delete(slug);
    onChange([...next]);
  }

  function resetToPreset(): void {
    onChange([...ROLE_PRESETS[role]]);
  }

  const presetMatches =
    permissions.length === ROLE_PRESETS[role].length &&
    ROLE_PRESETS[role].every((s) => set.has(s));

  // OWNER gets everything — no need to render togglable checkboxes.
  if (role === "OWNER") {
    return (
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-3 text-body-sm text-[var(--text-secondary)]">
        OWNER has full access to every page. Permissions can&apos;t be
        narrowed via this form.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-body-sm font-medium text-[var(--text-primary)]">
          Page permissions
        </p>
        <button
          type="button"
          onClick={resetToPreset}
          disabled={disabled || presetMatches}
          className="text-caption font-medium text-[var(--accent-hover)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--text-tertiary)] disabled:no-underline"
        >
          Reset to {role.toLowerCase()} defaults
        </button>
      </div>
      <div className="space-y-3">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
              {group.label}
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {group.slugs.map((slug) => (
                <label
                  key={slug}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-body-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                >
                  <input
                    type="checkbox"
                    checked={set.has(slug)}
                    onChange={(e) => toggle(slug, e.target.checked)}
                    disabled={disabled}
                    className="size-4 rounded border-[var(--border-default)] accent-[var(--accent-base)]"
                  />
                  <span>{labelForPermission(slug)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-h4 text-[var(--text-primary)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]"
          >
            <Check className="hidden" />
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
