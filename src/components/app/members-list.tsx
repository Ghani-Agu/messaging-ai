import type { ReactNode } from "react";
import * as Avatar from "@radix-ui/react-avatar";
import type { TenantMember } from "@/server/db/tenancy";
import { RoleBadge } from "./role-badge";
import { cn } from "@/lib/utils";

/**
 * Members list — designed to grow with later phases.
 *
 * Phase 2: read-only roster. Each row shows avatar / name / email /
 *   "(you)" tag / role badge. OWNER rows visually float to the top
 *   (sort handled in db helper).
 *
 * Phase 8/9 will add:
 *   - <InviteRow> rendered before the list (email input + role select).
 *     Drop in alongside the <ul>; the existing rows don't change.
 *   - Per-row action menu (change role, remove). The MemberRow signature
 *     already accepts an optional `actions` slot — that's the mounting
 *     point. No structural rewrite needed.
 */
export function MembersList({
  members,
  currentUserId,
  renderInvite,
  renderRowActions,
}: {
  members: TenantMember[];
  currentUserId: string;
  /** Slot for the invite row that lands in Phase 9. Phase 2: not provided. */
  renderInvite?: () => ReactNode;
  /** Per-row action slot for change-role / remove. Phase 2: not provided. */
  renderRowActions?: (member: TenantMember) => ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      {renderInvite ? renderInvite() : null}
      <ul role="list" className="divide-y divide-[var(--border-subtle)]">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isYou={m.user.id === currentUserId}
            actions={renderRowActions ? renderRowActions(m) : null}
          />
        ))}
      </ul>
    </div>
  );
}

function MemberRow({
  member,
  isYou,
  actions,
}: {
  member: TenantMember;
  isYou: boolean;
  actions: ReactNode;
}) {
  const display =
    member.user.name?.trim() ||
    member.user.email?.split("@")[0] ||
    "Unnamed user";
  const initials = (member.user.name ?? member.user.email ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <li className="flex items-center gap-4 bg-[var(--bg-surface)] px-5 py-4">
      <MemberAvatar
        src={member.user.image ?? null}
        initials={initials}
        alt=""
      />
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
        {member.user.email && member.user.email !== display ? (
          <span className="truncate text-body-sm text-[var(--text-secondary)]">
            {member.user.email}
          </span>
        ) : null}
      </div>
      <RoleBadge role={member.role} />
      {actions ? <div className="ml-2">{actions}</div> : null}
    </li>
  );
}

function MemberAvatar({
  src,
  initials,
  alt,
}: {
  src: string | null;
  initials: string;
  alt: string;
}) {
  return (
    <Avatar.Root
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-[var(--bg-surface-overlay)]",
      )}
    >
      {src ? (
        <Avatar.Image
          src={src}
          alt={alt}
          className="size-full object-cover"
        />
      ) : null}
      <Avatar.Fallback
        delayMs={src ? 200 : 0}
        className="text-body-sm font-semibold text-[var(--text-secondary)]"
      >
        {initials}
      </Avatar.Fallback>
    </Avatar.Root>
  );
}
