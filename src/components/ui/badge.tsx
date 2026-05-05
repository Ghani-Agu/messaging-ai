import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium",
  {
    variants: {
      variant: {
        default:
          "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]",
        success:
          "border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]",
        warning:
          "border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-[var(--warning)]",
        danger:
          "border-[color-mix(in_oklab,var(--danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] text-[var(--danger)]",
        accent:
          "border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)] bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--accent-hover)]",
        info: "border-[color-mix(in_oklab,var(--accent-secondary)_30%,transparent)] bg-[color-mix(in_oklab,var(--accent-secondary)_15%,transparent)] text-[var(--accent-secondary)]",
      },
      size: {
        sm: "h-5 px-1.5 text-[10px]",
        md: "h-6 px-2 text-caption",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "span";
    return (
      <Comp
        ref={ref}
        className={cn(badgeVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Badge.displayName = "Badge";

export { badgeVariants };
