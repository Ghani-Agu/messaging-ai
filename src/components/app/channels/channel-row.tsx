import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Single row in the Channels list page. Renders an icon, the channel name,
 * a status pill, optional description, and either a chevron link to the
 * detail page (when `href` is set) or a muted "Coming in Phase N" badge
 * (when `comingInPhase` is set). Mutually exclusive — `href` wins if both.
 *
 * Status pill semantics:
 *   - "connected" → success Badge; widget channel is live and serving.
 *                   Row picks up the active Card variant (per-tenant accent
 *                   border + glow) so connected channels stand out at a
 *                   glance.
 *   - "paused"    → warning Badge; channel exists but operator-paused
 *                   (mapped from DISCONNECTED / ERROR statuses on read).
 *   - "available" → default Badge; not yet enabled (no row exists).
 */
export type ChannelRowStatus = "connected" | "paused" | "available";

const STATUS_BADGE: Record<
  ChannelRowStatus,
  { label: string; variant: "success" | "warning" | "default" }
> = {
  connected: { label: "Connected", variant: "success" },
  paused: { label: "Paused", variant: "warning" },
  available: { label: "Available", variant: "default" },
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
            <Badge variant={STATUS_BADGE[status].variant} size="sm">
              {STATUS_BADGE[status].label}
            </Badge>
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
        <Badge variant="default" size="md">
          Phase {comingInPhase}
        </Badge>
      ) : null}
    </>
  );

  // Connected channels get the active Card variant (accent border + glow);
  // everything else uses the default Card. Override padding on top so the
  // row stays single-line at compact heights.
  const variant = status === "connected" ? "active" : "default";
  const baseClass = cn(
    cardVariants({ variant }),
    "group flex items-center gap-4 px-4 py-3",
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
