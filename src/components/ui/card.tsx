import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Universal hover affordance for bordered cards: the border lifts toward
// the accent and a soft accent glow drops in. Applies to default + active;
// ghost stays bare. Reduced-motion users get instant state changes.
const HOVER_GLOW =
  "transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none " +
  "hover:border-[color-mix(in_oklab,var(--accent-base)_45%,transparent)] " +
  "hover:shadow-[0_0_24px_var(--accent-glow)]";

const cardVariants = cva("", {
  variants: {
    variant: {
      // Default — soft surface card with a hover glow affordance.
      default:
        "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm " +
        HOVER_GLOW,
      // Active — stronger accent border at rest; same hover treatment as
      // default (border further toward accent + glow). No permanent glow
      // so the surface stays calm at rest.
      active:
        "rounded-lg border border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)] bg-[var(--bg-surface)] shadow-sm " +
        HOVER_GLOW,
      // Ghost — bare. No border, no surface, no shadow. For when the
      // surrounding chrome already provides the container.
      ghost: "",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-h4 text-[var(--text-primary)]", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-body-sm text-[var(--text-secondary)]", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 p-6 pt-0", className)}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

export { cardVariants };
