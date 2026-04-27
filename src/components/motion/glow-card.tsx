"use client";

import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { type ReactNode, type MouseEvent, useCallback } from "react";
import { cn } from "@/lib/utils";
import { durationFast, easeOutExpo } from "@/lib/motion";

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  /** Strength of the violet halo on hover. 0–1, default 0.6. */
  intensity?: number;
}

/**
 * Pointer-tracked glow surface. The accent halo follows the cursor; the card
 * lifts 2px on hover. Used for primary marketing surfaces and hero tiles.
 */
export function GlowCard({ children, className, intensity = 0.6 }: GlowCardProps) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  const background = useMotionTemplate`radial-gradient(420px circle at ${mouseX}px ${mouseY}px, rgba(124, 58, 237, ${intensity * 0.25}), transparent 70%)`;

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      whileHover={{ y: -2 }}
      transition={{ duration: durationFast, ease: easeOutExpo }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6",
        "transition-colors duration-150 hover:border-[var(--border-default)]",
        className,
      )}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}
