"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  Loader2,
  Mail,
  MoreVertical,
  Pencil,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import type { InvitationStatus, Role } from "@prisma/client";
import {
  PERMISSION_GROUPS,
  ROLE_PRESETS,
  isPermissionSlug,
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
    <ModalShell
      title="Invite a teammate"
      onClose={onClose}
      footer={
        <ModalActions
          error={error}
          onCancel={onClose}
          onSubmit={submit}
          pending={pending}
          submitDisabled={!email}
          submitLabel="Send invitation"
          pendingLabel="Sending…"
        />
      }
    >
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
    // Filter the persisted strings down to known PermissionSlug values.
    // Earlier revisions filtered against ROLE_PRESETS.OWNER.includes, which
    // works accidentally only because OWNER's preset IS the full slug list —
    // the intent is "drop unknown / deleted slugs," which `isPermissionSlug`
    // expresses directly.
    member.permissions.filter(isPermissionSlug),
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
    <ModalShell
      title={`Edit ${member.name ?? member.email ?? "member"}`}
      onClose={onClose}
      footer={
        <ModalActions
          error={error}
          onCancel={onClose}
          onSubmit={submit}
          pending={pending}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      }
    >
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

/**
 * Friendlier page labels for the paired view/edit rows. Each PERMISSION_SLUGS
 * entry's prefix maps to a single human-readable page name; the row renders
 * "Products" once with [View][Edit] toggles on the right rather than two
 * separate "View products" / "Manage products" checkbox rows.
 */
const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  conversations: "Conversations",
  documents: "Documents",
  products: "Products",
  qna: "Q&A",
  "business-info": "Business info",
  "live-data": "Live-data sources",
  "knowledge-gaps": "Knowledge gaps",
  channels: "Channels",
  playground: "Playground",
  settings: "Settings",
  contacts: "Contacts",
  members: "Members",
};

function pageLabelForSlug(slug: PermissionSlug): string {
  const page = slug.split(":")[0]!;
  return PAGE_LABELS[page] ?? page;
}

type PermissionRowShape =
  | {
      kind: "pair";
      label: string;
      viewSlug: PermissionSlug;
      editSlug: PermissionSlug;
    }
  | {
      kind: "solo";
      label: string;
      slug: PermissionSlug;
      action: "view" | "edit";
    };

/**
 * Walk the group's slugs and collapse adjacent view/edit pairs onto one row.
 * Solo slugs (e.g. dashboard:view, playground:view, members:edit when
 * `members:view` isn't in the same preset) render on their own.
 */
function buildPermissionRows(
  slugs: readonly PermissionSlug[],
): PermissionRowShape[] {
  const slugSet = new Set<string>(slugs);
  const seen = new Set<string>();
  const rows: PermissionRowShape[] = [];
  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    const [page, action] = slug.split(":");
    if (action === "view" && page) {
      const editSlug = `${page}:edit` as PermissionSlug;
      if (slugSet.has(editSlug)) {
        rows.push({
          kind: "pair",
          label: pageLabelForSlug(slug),
          viewSlug: slug,
          editSlug,
        });
        seen.add(slug);
        seen.add(editSlug);
        continue;
      }
    }
    rows.push({
      kind: "solo",
      label: pageLabelForSlug(slug),
      slug,
      action: action === "edit" ? "edit" : "view",
    });
    seen.add(slug);
  }
  return rows;
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
  const preset = ROLE_PRESETS[role];
  const presetSet = useMemo(() => new Set(preset), [preset]);

  // Count slugs that diverge from the role preset in either direction:
  // user added one not in the preset, or removed one that the preset
  // would have granted. Total = both buckets summed.
  const customizationCount = useMemo(() => {
    let count = 0;
    for (const slug of set) if (!presetSet.has(slug)) count += 1;
    for (const slug of presetSet) if (!set.has(slug)) count += 1;
    return count;
  }, [set, presetSet]);

  function resetToPreset(): void {
    onChange([...preset]);
  }

  /**
   * Toggling the view pill enforces the invariant `edit implies view`:
   * turning view OFF cascades the edit slug off too (you can't edit what
   * you can't see). Turning view ON has no edit-side effect.
   */
  function toggleView(
    viewSlug: PermissionSlug,
    editSlug: PermissionSlug | null,
    on: boolean,
  ): void {
    const next = new Set(set);
    if (on) {
      next.add(viewSlug);
    } else {
      next.delete(viewSlug);
      if (editSlug) next.delete(editSlug);
    }
    onChange([...next]);
  }

  /**
   * Toggling the edit pill: ON auto-ticks view (edit implies view); OFF
   * just clears edit.
   */
  function toggleEdit(
    viewSlug: PermissionSlug,
    editSlug: PermissionSlug,
    on: boolean,
  ): void {
    const next = new Set(set);
    if (on) {
      next.add(viewSlug);
      next.add(editSlug);
    } else {
      next.delete(editSlug);
    }
    onChange([...next]);
  }

  function toggleSolo(slug: PermissionSlug, on: boolean): void {
    const next = new Set(set);
    if (on) next.add(slug);
    else next.delete(slug);
    onChange([...next]);
  }

  // OWNER gets everything regardless — no togglable surface to render.
  if (role === "OWNER") {
    return (
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-3 text-body-sm text-[var(--text-secondary)]">
        OWNER has full access to every page. Permissions can&apos;t be
        narrowed via this form.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PresetStatus customizations={customizationCount} role={role} />
        <button
          type="button"
          onClick={resetToPreset}
          disabled={disabled || customizationCount === 0}
          className="text-caption font-medium text-[var(--accent-hover)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--text-tertiary)] disabled:no-underline"
        >
          Reset to {role.toLowerCase()} defaults
        </button>
      </div>
      <div className="space-y-3">
        {PERMISSION_GROUPS.map((group) => (
          <PermissionsGroupCard
            key={group.label}
            label={group.label}
            slugs={group.slugs}
            set={set}
            disabled={disabled}
            onToggleView={toggleView}
            onToggleEdit={toggleEdit}
            onToggleSolo={toggleSolo}
          />
        ))}
      </div>
    </div>
  );
}

function PresetStatus({
  customizations,
  role,
}: {
  customizations: number;
  role: Role;
}) {
  if (customizations === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-2.5 py-1 text-caption text-[var(--text-secondary)]">
        <Check className="size-3" aria-hidden />
        Matches {role.toLowerCase()} preset
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)] bg-[color-mix(in_oklab,var(--accent-base)_12%,transparent)] px-2.5 py-1 text-caption text-[var(--accent-hover)]">
      <Pencil className="size-3" aria-hidden />
      Customized · {customizations}{" "}
      {customizations === 1 ? "change" : "changes"} from {role.toLowerCase()}{" "}
      preset
    </span>
  );
}

function PermissionsGroupCard({
  label,
  slugs,
  set,
  disabled,
  onToggleView,
  onToggleEdit,
  onToggleSolo,
}: {
  label: string;
  slugs: readonly PermissionSlug[];
  set: Set<PermissionSlug>;
  disabled: boolean;
  onToggleView: (
    viewSlug: PermissionSlug,
    editSlug: PermissionSlug | null,
    on: boolean,
  ) => void;
  onToggleEdit: (
    viewSlug: PermissionSlug,
    editSlug: PermissionSlug,
    on: boolean,
  ) => void;
  onToggleSolo: (slug: PermissionSlug, on: boolean) => void;
}) {
  const rows = useMemo(() => buildPermissionRows(slugs), [slugs]);
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
        <p className="text-caption font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
          {label}
        </p>
      </div>
      <ul role="list" className="divide-y divide-[var(--border-subtle)]">
        {rows.map((row) => (
          <li
            key={row.kind === "pair" ? row.viewSlug : row.slug}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <span className="text-body-sm text-[var(--text-primary)]">
              {row.label}
            </span>
            {row.kind === "pair" ? (
              <div className="flex items-center gap-1.5">
                <PermissionToggle
                  label="View"
                  checked={set.has(row.viewSlug)}
                  disabled={disabled}
                  onChange={(on) => onToggleView(row.viewSlug, row.editSlug, on)}
                />
                <PermissionToggle
                  label="Edit"
                  checked={set.has(row.editSlug)}
                  disabled={disabled}
                  onChange={(on) => onToggleEdit(row.viewSlug, row.editSlug, on)}
                />
              </div>
            ) : (
              <PermissionToggle
                label={row.action === "edit" ? "Edit" : "View"}
                checked={set.has(row.slug)}
                disabled={disabled}
                onChange={(on) => onToggleSolo(row.slug, on)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Two-state pill. role="switch" so screen readers announce on/off; visual
 * style mirrors the playground's segmented radio group + the AI Behavior
 * toggles (existing app vocabulary, not a bespoke control).
 */
function PermissionToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-7 min-w-[3.25rem] items-center justify-center rounded-md border px-2 text-caption font-medium transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface-elevated)]",
        checked
          ? "border-[color-mix(in_oklab,var(--accent-base)_40%,transparent)] bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--accent-hover)]"
          : "border-[var(--border-subtle)] bg-transparent text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Shared footer body for the invite + edit modals. Renders the error message
 * (if any) inside the sticky footer so it stays visible even when the body
 * is scrolled, then the Cancel + primary action buttons.
 */
function ModalActions({
  error,
  onCancel,
  onSubmit,
  pending,
  submitDisabled,
  submitLabel,
  pendingLabel,
}: {
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  pending: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  pendingLabel: string;
}) {
  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-body-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-md border border-[var(--border-subtle)] bg-transparent px-4 text-body-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-default)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || submitDisabled}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-base)] px-4 text-body-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {pendingLabel}
            </>
          ) : (
            submitLabel
          )}
        </button>
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
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Optional sticky footer. When provided, renders below a bordered
   * separator at the bottom of the modal and stays always visible
   * regardless of body scroll. Pass action buttons (Cancel / Save) here
   * so they're never clipped on tall content.
   */
  footer?: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Scroll affordance — top + bottom gradient fades that appear when the
  // body has more content above / below the visible region. Recalculated
  // on scroll + on body resize (which catches role changes that swap
  // PermissionsPicker between full-grid and OWNER-notice).
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update(): void {
      const node = scrollRef.current;
      if (!node) return;
      setCanScrollUp(node.scrollTop > 4);
      setCanScrollDown(
        node.scrollTop + node.clientHeight < node.scrollHeight - 4,
      );
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Observing the immediate child catches inner-content resizes too
    // (e.g., role swap toggling the picker height).
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // Inset shadows on the scroll container — visual signal that content
  // is clipped above (top) and/or below (bottom). Composed inline so the
  // conditional joining stays a single CSS `box-shadow` value (multiple
  // shadows comma-separated). transition-shadow on the element gives a
  // soft fade-in/out when the scroll state flips.
  const innerShadow =
    [
      canScrollUp ? "inset 0 14px 14px -14px rgba(0, 0, 0, 0.5)" : null,
      canScrollDown ? "inset 0 -14px 14px -14px rgba(0, 0, 0, 0.5)" : null,
    ]
      .filter(Boolean)
      .join(", ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-4">
          <h2 className="text-h4 text-[var(--text-primary)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Scrollable body. `flex-auto` (not `flex-1`) gives this child a
            content-based flex-basis so the panel's natural main-size sees
            the real body height and the max-h-[90vh] cap actually engages.
            `flex-1` (= flex: 1 1 0%) would invisibly collapse the body to
            0 inside an auto-height column container — the bug this fix
            replaces. `min-h-0` keeps the flex item shrinkable below
            content; `overflow-y-auto` resolves the same min-height
            implicitly per spec, but the explicit class is defense-in-
            depth. The inset box-shadow is the scroll affordance — fades
            in at top / bottom only when there's clipped content in that
            direction. */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-auto overflow-y-auto px-6 py-4 transition-shadow duration-150"
          style={innerShadow ? { boxShadow: innerShadow } : undefined}
        >
          {children}
        </div>
        {/* Sticky footer */}
        {footer ? (
          <div className="shrink-0 border-t border-[var(--border-subtle)] px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
