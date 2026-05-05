"use client";

import { motion, useReducedMotion } from "framer-motion";
import { durationDeliberate, easeOutExpo } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Animated confidence meter (MASTER_PLAN §4.7 theatrical moment #4).
 * Renders a 0–100 horizontal bar that draws in from 0 to the final
 * width on mount. Color shifts in three brackets keyed off the
 * existing palette tokens (no token math — keeps the design system
 * coherent):
 *
 *   confidence < 0.4  → danger  (low — operator should not trust)
 *   0.4 ≤ x < 0.7     → warning (moderate — verify before relying)
 *   confidence ≥ 0.7  → success (high — solid grounding)
 *
 * Reduced-motion: instant fill, no transition.
 */
export function PlaygroundConfidenceMeter({
  confidence,
  className,
}: {
  /** 0..1 from the brain's BrainResult.confidence. */
  confidence: number;
  className?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, confidence));
  const percent = Math.round(clamped * 100);
  const bracket = clamped < 0.4 ? "low" : clamped < 0.7 ? "mid" : "high";

  // Static class maps so Tailwind's content scanner picks them up.
  // (Per CLAUDE.md: never template-literal class names.)
  const fillClass =
    bracket === "low"
      ? "bg-[var(--danger)]"
      : bracket === "mid"
        ? "bg-[var(--warning)]"
        : "bg-[var(--success)]";
  const labelClass =
    bracket === "low"
      ? "text-[var(--danger)]"
      : bracket === "mid"
        ? "text-[var(--warning)]"
        : "text-[var(--success)]";

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      role="meter"
      aria-label="AI confidence"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <motion.div
          aria-hidden
          initial={{ width: prefersReducedMotion ? `${percent}%` : "0%" }}
          animate={{ width: `${percent}%` }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: durationDeliberate, ease: easeOutExpo }
          }
          className={cn("h-full rounded-full", fillClass)}
        />
      </div>
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] font-medium tabular-nums",
          labelClass,
        )}
      >
        {percent}%
      </span>
    </div>
  );
}
