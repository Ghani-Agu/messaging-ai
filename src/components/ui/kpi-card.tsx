import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

const kpiCardVariants = cva(
  "relative overflow-hidden rounded-lg border p-5 transition-colors duration-150 ease-out",
  {
    variants: {
      variant: {
        default: "border-[var(--border-subtle)] bg-[var(--bg-surface)]",
        active:
          "border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)] bg-[var(--bg-surface)] shadow-[var(--shadow-glow)]",
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
 * gets the accent glow, an inset accent shadow, and a corner radial
 * "spotlight" gradient that picks up the per-tenant accent automatically.
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
      {variant === "active" ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 size-32"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in oklab, var(--accent-base) 22%, transparent) 0%, transparent 70%)",
          }}
        />
      ) : null}
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
