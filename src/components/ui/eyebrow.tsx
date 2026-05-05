import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const eyebrowVariants = cva(
  "inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider",
  {
    variants: {
      variant: {
        tertiary: "text-[var(--text-tertiary)]",
        accent: "text-[var(--accent-hover)]",
      },
    },
    defaultVariants: { variant: "tertiary" },
  },
);

export interface EyebrowProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof eyebrowVariants> {
  icon?: LucideIcon;
  children: ReactNode;
}

export const Eyebrow = forwardRef<HTMLSpanElement, EyebrowProps>(
  ({ className, variant, icon: Icon, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(eyebrowVariants({ variant }), className)}
      {...props}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  ),
);
Eyebrow.displayName = "Eyebrow";

export { eyebrowVariants };
