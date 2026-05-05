"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Operator-app ambient backdrop. Same shape as AuthMeshBackdrop (corner
 * radial blobs + edge vignette), but mounted inside the per-tenant
 * [data-tenant=…] wrapper, so the violet `--accent-base` resolves to the
 * tenant's override (orange for wbp, etc.) without any prop wiring.
 *
 * `tenantTinted` is a marker for intent — the visual difference is driven
 * automatically by CSS-variable scoping. Off-tenant call sites should pass
 * false so future readers don't assume the backdrop reads tenant accent.
 *
 * Honours `prefers-reduced-motion`: the breathing loops collapse to a
 * static mid-cycle opacity.
 */

// Slow ambient breathing — see auth-mesh-backdrop for the same constants.
// Single consumer per file; if a third backdrop surface needs them, lift
// into src/lib/motion.ts.
const BREATHE_DURATION_S = 14;
const BREATHE_DURATION_OFFSET_S = 18;

export interface AmbientBackdropProps {
  /** Whether this backdrop is mounted inside a per-tenant scope. */
  tenantTinted?: boolean;
}

export function AmbientBackdrop({ tenantTinted = false }: AmbientBackdropProps) {
  const prefersReducedMotion = useReducedMotion();
  // tenantTinted is currently a documentation-only marker; the visual is
  // driven by CSS variable scoping. Reading it here so the prop is "used"
  // for typecheck without affecting runtime — keeps a future opt-out easy.
  void tenantTinted;

  return (
    <>
      {/* Base mesh — static, theme-aware via the --gradient-mesh token. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20"
        style={{ background: "var(--gradient-mesh)" }}
      />

      {/* Top-right accent glow — picks up the tenant override automatically. */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -right-32 -top-32 -z-20 size-[700px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--accent-base) 24%, transparent) 0%, transparent 70%)",
        }}
        initial={{ opacity: prefersReducedMotion ? 0.65 : 0.45 }}
        animate={
          prefersReducedMotion ? undefined : { opacity: [0.45, 0.85, 0.45] }
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

      {/* Bottom-left cyan-secondary glow. */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -bottom-32 -left-32 -z-20 size-[700px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--accent-secondary) 20%, transparent) 0%, transparent 70%)",
        }}
        initial={{ opacity: prefersReducedMotion ? 0.55 : 0.35 }}
        animate={
          prefersReducedMotion ? undefined : { opacity: [0.35, 0.7, 0.35] }
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

      {/* Edge vignette — keeps the blobs subordinate to chrome + content. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, var(--bg-base) 95%)",
        }}
      />
    </>
  );
}
