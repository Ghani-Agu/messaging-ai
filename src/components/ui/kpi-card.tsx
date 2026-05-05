import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

// Same hover affordance as the Card primitive — the border lifts toward
// the accent and a soft accent glow drops in. Reduced-motion users get
// instant state changes.
const HOVER_GLOW =
  "transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none " +
  "hover:border-[color-mix(in_oklab,var(--accent-base)_45%,transparent)] " +
  "hover:shadow-[0_0_24px_var(--accent-glow)]";

const kpiCardVariants = cva(
  "relative overflow-hidden rounded-lg border p-5 " + HOVER_GLOW,
  {
    variants: {
      variant: {
        default: "border-[var(--border-subtle)] bg-[var(--bg-surface)]",
        // Stronger accent border at rest. No permanent corner radial /
        // glow — the surface stays calm at rest and lights up on hover.
        active:
          "border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)] bg-[var(--bg-surface)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface KpiCardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof kpiCardVariants> {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  /** Small footer slot under the value (e.g. delta label, last-updated time). */
  footer?: ReactNode;
}

/**
 * KPI tile. Used in the dashboard's headline metrics row. Active variant
 * has a slightly stronger accent border but no permanent glow / splash —
 * every variant picks up the same hover affordance (accent border + glow)
 * as the Card primitive.
 */
export const KpiCard = forwardRef<HTMLDivElement, KpiCardProps>(
  (
    { className, variant, label, value, icon: Icon, footer, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(kpiCardVariants({ variant }), className)}
      {...props}
    >
      <div className="relative flex items-start justify-between gap-4">
        <Eyebrow>{label}</Eyebrow>
        {Icon ? (
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--accent-base) 15%, transparent)",
              color: "var(--accent-hover)",
            }}
          >
            <Icon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <p className="relative mt-3 text-h2 leading-none text-[var(--text-primary)]">
        {value}
      </p>
      {footer ? (
        <div className="relative mt-4 text-body-sm text-[var(--text-tertiary)]">
          {footer}
        </div>
      ) : null}
    </div>
  ),
);
KpiCard.displayName = "KpiCard";

export { kpiCardVariants };
