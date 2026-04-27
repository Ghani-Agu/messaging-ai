"use client";

import { useCallback } from "react";
import { useTheme } from "next-themes";

const TRANSITION_CLASS = "theme-transitioning";
const FALLBACK_DURATION_MS = 220;

type ThemeValue = "light" | "dark" | "system";

type StartViewTransition = (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };

/**
 * Theme switcher with two animation paths:
 *
 * 1. **View Transitions API** (Chromium 111+, Safari 18+, Edge 111+) —
 *    `document.startViewTransition(...)` performs a snapshot crossfade
 *    between the old and new theme states. Handles arbitrary layout
 *    changes (icon swap, gradient flips) without effort.
 * 2. **CSS-variable fallback** (Firefox today, older Safari) — temporarily
 *    add a `theme-transitioning` class to the documentElement that
 *    enables a 200ms ease-out-expo transition on background/text/border
 *    color tokens. Class is removed after the duration so day-to-day
 *    hover states stay snappy and don't double-animate.
 *
 * Both paths target the same ~200–250ms feel; the fallback is strictly
 * the colour interpolation (no snapshot crossfade), so it can show
 * mid-transition tints — that's expected. The smoothness check is
 * recorded in the end-of-session summary.
 */
export function useThemeSwitcher() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const switchTheme = useCallback(
    (next: ThemeValue) => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        setTheme(next);
        return;
      }

      const start = (
        document as Document & { startViewTransition?: StartViewTransition }
      ).startViewTransition;

      if (typeof start === "function") {
        start.call(document, () => {
          setTheme(next);
        });
        return;
      }

      // Fallback path
      const root = document.documentElement;
      root.classList.add(TRANSITION_CLASS);
      setTheme(next);
      window.setTimeout(() => {
        root.classList.remove(TRANSITION_CLASS);
      }, FALLBACK_DURATION_MS);
    },
    [setTheme],
  );

  return { theme, resolvedTheme, switchTheme };
}
