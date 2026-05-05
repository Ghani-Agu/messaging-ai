import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  /** Eyebrow label rendered above the value. */
  label: ReactNode;
  value: ReactNode;
}

/**
 * Compact key/value display used inside cards (mini-KPI strips on
 * conversation rows, channel detail config rows, etc.). Renders the
 * same shape as the audit-§6 "field" composition that pages were
 * inlining over and over.
 */
export const Field = forwardRef<HTMLDivElement, FieldProps>(
  ({ className, label, value, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-3 py-2.5",
        className,
      )}
      {...props}
    >
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 text-body-sm font-medium text-[var(--text-primary)]">
        {value}
      </p>
    </div>
  ),
);
Field.displayName = "Field";
