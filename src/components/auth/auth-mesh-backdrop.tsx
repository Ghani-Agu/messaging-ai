"use client";

import { motion } from "framer-motion";

/**
 * Slowly drifting mesh gradient backdrop for the auth screens — one of the
 * "theatrical moments" the design system reserves for sign-up / sign-in.
 * Uses --gradient-mesh tokens (which already adapt to light/dark theme),
 * just nudges the background-position over a long loop for subtle motion.
 */
export function AuthMeshBackdrop() {
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20"
        style={{
          background: "var(--gradient-mesh)",
          backgroundSize: "120% 120%",
        }}
        initial={{ backgroundPosition: "0% 0%" }}
        animate={{
          backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"],
        }}
        transition={{ duration: 30, ease: "easeInOut", repeat: Infinity }}
      />
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
