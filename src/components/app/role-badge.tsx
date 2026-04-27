import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";

type Variant = {
  label: string;
  className: string;
};

const VARIANTS: Record<Role, Variant> = {
  OWNER: {
    label: "Owner",
    // Gradient pill — the only one with the accent gradient, so the OWNER row
    // reads at a glance.
    className: "text-white border-transparent",
  },
  ADMIN: {
    label: "Admin",
    className:
      "bg-[color-mix(in_oklab,var(--accent-base)_18%,transparent)] text-[var(--accent-hover)] border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)]",
  },
  AGENT: {
    label: "Agent",
    className:
      "bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] border-[var(--border-default)]",
  },
  VIEWER: {
    label: "Viewer",
    className:
      "bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-subtle)]",
  },
};

export function RoleBadge({ role }: { role: Role }) {
  const v = VARIANTS[role];
  const isOwner = role === "OWNER";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium uppercase tracking-wider",
        v.className,
      )}
      style={isOwner ? { background: "var(--gradient-primary)" } : undefined}
    >
      {v.label}
    </span>
  );
}
