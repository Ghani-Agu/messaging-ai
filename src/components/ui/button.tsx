"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,box-shadow,transform,color] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    "active:scale-[0.98]",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--accent-base)] text-white",
          "hover:bg-[var(--accent-hover)] hover:shadow-[0_0_24px_var(--accent-glow)]",
          "active:bg-[var(--accent-active)]",
        ],
        secondary: [
          "bg-[var(--bg-surface-elevated)] text-[var(--text-primary)]",
          "border border-[var(--border-default)]",
          "hover:bg-[var(--bg-surface-overlay)] hover:border-[var(--border-strong)]",
        ],
        ghost: [
          "bg-transparent text-[var(--text-secondary)]",
          "hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
        ],
        outline: [
          "bg-transparent text-[var(--text-primary)]",
          "border border-[var(--border-default)]",
          "hover:border-[var(--accent-base)] hover:text-[var(--accent-hover)]",
        ],
        destructive: [
          "bg-[var(--danger)] text-white",
          "hover:bg-red-500 hover:shadow-[0_0_24px_rgba(239,68,68,0.35)]",
        ],
        link: [
          "bg-transparent text-[var(--accent-hover)] underline-offset-4",
          "hover:underline hover:text-[var(--accent-base)]",
        ],
      },
      size: {
        sm: "h-8 px-3 text-body-sm rounded-md",
        md: "h-9 px-4 text-body rounded-md",
        lg: "h-11 px-6 text-body rounded-lg",
        xl: "h-12 px-8 text-body-lg rounded-lg",
        icon: "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
