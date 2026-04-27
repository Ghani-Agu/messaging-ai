"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { forwardRef, useRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

// Spring options inlined here (rather than imported from @/lib/motion) because
// useSpring takes SpringOptions, not the broader Framer Transition type.
const magneticSpring = { stiffness: 400, damping: 30 } as const;

// Drag/animation handlers on motion.button conflict with React's
// HTMLButtonElement events of the same names. Strip them from the
// passthrough props so we can spread cleanly onto motion.button.
type MagneticButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
> & {
  /** Maximum displacement (px) the button drifts toward the cursor. */
  strength?: number;
  /** Loading state — disables interaction and the magnetic effect. */
  pending?: boolean;
};

export const MagneticButton = forwardRef<HTMLButtonElement, MagneticButtonProps>(
  function MagneticButton(
    { children, className, strength = 8, pending = false, disabled, ...props },
    ref,
  ) {
    const localRef = useRef<HTMLButtonElement | null>(null);
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const sx = useSpring(x, magneticSpring);
    const sy = useSpring(y, magneticSpring);

    function handleMove(e: MouseEvent<HTMLButtonElement>) {
      if (pending || disabled) return;
      const node = localRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width / 2);
      const dy = (e.clientY - cy) / (rect.height / 2);
      x.set(Math.max(-1, Math.min(1, dx)) * strength);
      y.set(Math.max(-1, Math.min(1, dy)) * strength);
    }

    function handleLeave() {
      x.set(0);
      y.set(0);
    }

    return (
      <motion.button
        ref={(node) => {
          localRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        style={{ x: sx, y: sy }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        className={cn(
          "relative inline-flex h-11 w-full items-center justify-center gap-2",
          "rounded-lg px-6 text-body font-medium text-white",
          "bg-[var(--accent-base)]",
          "shadow-[0_0_0_0_var(--accent-glow)] hover:shadow-[0_0_32px_var(--accent-glow)]",
          "transition-[background-color,box-shadow] duration-150 ease-out",
          "hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </motion.button>
    );
  },
);
