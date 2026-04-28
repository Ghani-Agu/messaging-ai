import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single row in the Channels list page. Renders an icon, the channel name,
 * a status pill, optional description, and either a chevron link to the
 * detail page (when `href` is set) or a muted "Coming in Phase N" badge
 * (when `comingInPhase` is set). Mutually exclusive — `href` wins if both.
 *
 * Status pill semantics:
 *   - "connected" → success green; widget channel is live and serving.
 *   - "paused"    → warning amber; channel exists but operator-paused
 *                   (mapped from DISCONNECTED / ERROR statuses on read).
 *   - "available" → muted neutral; not yet enabled (no row exists).
 *   - "soon"      → muted neutral with phase tag; render via comingInPhase.
 */
export type ChannelRowStatus = "connected" | "paused" | "available";

const STATUS_VARIANTS: Record<ChannelRowStatus, { label: string; className: string }> = {
  connected: {
    label: "Connected",
    className:
      "bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)] border-[color-mix(in_oklab,var(--success)_30%,transparent)]",
  },
  paused: {
    label: "Paused",
    className:
      "bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-[var(--warning)] border-[color-mix(in_oklab,var(--warning)_30%,transparent)]",
  },
  available: {
    label: "Available",
    className:
      "bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-subtle)]",
  },
};

export function ChannelRow({
  icon: Icon,
  name,
  description,
  status,
  href,
  comingInPhase,
}: {
  icon: LucideIcon;
  name: string;
  description: string;
  status?: ChannelRowStatus;
  href?: string;
  comingInPhase?: number;
}) {
  const body = (
    <>
      <div
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)]"
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body font-medium text-[var(--text-primary)]">
            {name}
          </span>
          {status ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium",
                STATUS_VARIANTS[status].className,
              )}
            >
              {STATUS_VARIANTS[status].label}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-body-sm text-[var(--text-tertiary)]">
          {description}
        </p>
      </div>
      {href ? (
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-[var(--text-tertiary)] transition-colors duration-150 group-hover:text-[var(--text-secondary)]"
        />
      ) : comingInPhase !== undefined ? (
        <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-caption text-[var(--text-tertiary)]">
          Phase {comingInPhase}
        </span>
      ) : null}
    </>
  );

  const baseClass = cn(
    "group flex items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3",
    "transition-colors duration-150 ease-out",
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          baseClass,
          "hover:border-[var(--border-default)] hover:bg-[var(--bg-surface-elevated)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]",
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={cn(baseClass, "opacity-70")}>{body}</div>;
}
