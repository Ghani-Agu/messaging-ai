import type { Transition, Variants } from "framer-motion";

/**
 * Motion presets — single source of truth for every animation in the app.
 * Source: MASTER_PLAN.md §4 (Motion). Never inline timings or curves.
 */

// Easing curves
export const easeStandard = [0.4, 0, 0.2, 1] as const;
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

// Spring presets
export const easeSpring: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
};

export const easeSpringBouncy: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 25,
};

// Durations (seconds for Framer Motion)
export const durationFast = 0.15;
export const durationMedium = 0.25;
export const durationSlow = 0.4;
export const durationDeliberate = 0.6;

// Stagger
export const staggerChildren = 0.04;

// Common variants — reuse instead of redefining

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: durationMedium, ease: easeOutExpo },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: durationMedium, ease: easeOutExpo },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: easeSpring,
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren,
      delayChildren: 0.05,
    },
  },
};
