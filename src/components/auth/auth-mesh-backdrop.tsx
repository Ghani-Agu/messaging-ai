"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Corner-anchored ambient backdrop for the auth surfaces — one of the
 * "theatrical moments" the design system reserves for sign-up / sign-in.
 *
 * Three layers, all `pointer-events-none` and behind page content:
 *   1. The base `--gradient-mesh` token (theme-aware), static.
 *   2. Two large radial blobs anchored just outside opposite corners
 *      (top-right `--accent-base`, bottom-left `--accent-secondary`).
 *      They breathe in opacity on independent loops with offset phases
 *      so the result reads as a calm ambient drift, not a coordinated
 *      pulse.
 *   3. A radial vignette that fades the edges into `--bg-base` so the
 *      blobs don't compete with content.
 *
 * Honours `prefers-reduced-motion`: when set, both blobs render at
 * their mid-cycle opacity with no animation.
 */

// Slow ambient breathing. Inlined here — `src/lib/motion.ts` keeps
// only the durationFast/Medium/Slow/Deliberate scale (max 600ms),
// and these 14s/18s constants have one consumer. If a second backdrop
// surface appears, lift them into motion.ts.
const BREATHE_DURATION_S = 14;
const BREATHE_DURATION_OFFSET_S = 18;

export function AuthMeshBackdrop() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <>
      {/* Base mesh — static, theme-aware via the --gradient-mesh token. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20"
        style={{ background: "var(--gradient-mesh)" }}
      />

      {/* Top-right accent glow — anchored just outside the corner so only
          the spill lands inside the viewport. */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -right-32 -top-32 -z-20 size-[700px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--accent-base) 30%, transparent) 0%, transparent 70%)",
        }}
        initial={{ opacity: prefersReducedMotion ? 0.75 : 0.55 }}
        animate={
          prefersReducedMotion ? undefined : { opacity: [0.55, 1, 0.55] }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration: BREATHE_DURATION_S,
                ease: "easeInOut",
                repeat: Infinity,
              }
        }
      />

      {/* Bottom-left cyan-secondary glow — offset phase from the accent
          one so the two never breathe in sync. */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -bottom-32 -left-32 -z-20 size-[700px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--accent-secondary) 25%, transparent) 0%, transparent 70%)",
        }}
        initial={{ opacity: prefersReducedMotion ? 0.65 : 0.45 }}
        animate={
          prefersReducedMotion ? undefined : { opacity: [0.45, 0.85, 0.45] }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration: BREATHE_DURATION_OFFSET_S,
                ease: "easeInOut",
                repeat: Infinity,
              }
        }
      />

      {/* Edge vignette — keeps the blobs subordinate to page content. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, var(--bg-base) 90%)",
        }}
      />
    </>
  );
}
