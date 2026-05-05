import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Width tokens — keep this map literal so Tailwind's content scanner picks
// up every class string. No template-literal classNames anywhere.
const WIDTH_CLASS = {
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
} as const;

export type PageShellWidth = keyof typeof WIDTH_CLASS;

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  width?: PageShellWidth;
  children: ReactNode;
}

/**
 * Standard page wrapper for every operator-app surface. Replaces the inline
 * `mx-auto max-w-Xxl px-6 py-10 lg:px-10 lg:py-14` blocks that every page
 * was hand-rolling. Default width: 5xl.
 */
export const PageShell = forwardRef<HTMLDivElement, PageShellProps>(
  ({ className, width = "5xl", children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "mx-auto px-6 py-10 lg:px-10 lg:py-14",
        WIDTH_CLASS[width],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
PageShell.displayName = "PageShell";
