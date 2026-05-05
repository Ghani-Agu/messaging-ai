"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper around @radix-ui/react-tooltip styled to the design system.
 * Mounted explicitly per call site (no global Provider — Radix's docs are
 * fine with that; mounting a single Provider near the top is a perf hint,
 * not a correctness requirement).
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-2 py-1 text-caption text-[var(--text-secondary)] shadow-[var(--shadow-md)]",
        "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
        className,
      )}
      {...props}
    >
      {children}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

/**
 * Convenience wrapper for the most common case: a trigger that needs a
 * label tooltip. Mounts its own Provider so callers don't have to think
 * about it.
 */
export function TooltipHint({
  label,
  side = "right",
  delayDuration = 200,
  children,
}: {
  label: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
  children: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
