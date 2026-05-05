"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { durationDeliberate, easeOutExpo } from "@/lib/motion";

/**
 * Cubic Bézier evaluator at parameter `t` ∈ [0, 1] for the lib/motion
 * easeOutExpo curve `[0.16, 1, 0.3, 1]`. Used to ease a per-frame
 * progress value driving the count-up animation. Cheap quadratic
 * Newton-Raphson for the inverse — three iterations is more than
 * enough for a per-frame visual.
 */
function easeOutExpoAt(t: number): number {
  const [x1, y1, x2, y2] = easeOutExpo;
  // Bezier in one dimension: B(u) = 3(1-u)^2*u*p1 + 3(1-u)*u^2*p2 + u^3
  function bez(u: number, p1: number, p2: number): number {
    return 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u ** 2 * p2 + u ** 3;
  }
  function bezDeriv(u: number, p1: number, p2: number): number {
    return (
      3 * (1 - u) ** 2 * p1 +
      6 * (1 - u) * u * (p2 - p1) +
      3 * u ** 2 * (1 - p2)
    );
  }
  // Solve bez(u, x1, x2) = t for u via Newton's method.
  let u = t;
  for (let i = 0; i < 6; i++) {
    const x = bez(u, x1, x2) - t;
    const dx = bezDeriv(u, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    u = u - x / dx;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
  }
  return bez(u, y1, y2);
}

/**
 * Animates a number from 0 (or the previous returned value) up to
 * `target` over `duration` seconds using the design system's
 * easeOutExpo. Honors prefers-reduced-motion: returns `target`
 * immediately when set.
 *
 * Re-targeting mid-flight resumes from the current displayed value,
 * not from zero — so dashboards that re-render with a higher KPI
 * don't snap back to 0 first.
 *
 * `precision` controls decimal places (default 0 — integer counters).
 */
export function useCountUp(
  target: number,
  options?: { duration?: number; precision?: number },
): number {
  const duration = options?.duration ?? durationDeliberate;
  const precision = options?.precision ?? 0;
  const factor = 10 ** precision;
  const prefersReducedMotion = useReducedMotion();

  const [value, setValue] = useState(prefersReducedMotion ? target : 0);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (prefersReducedMotion) {
      setValue(target);
      return;
    }

    const start = valueRef.current;
    const delta = target - start;
    if (delta === 0) return;

    let frame = 0;
    const startTs = performance.now();
    const durationMs = duration * 1000;

    const tick = (now: number) => {
      const elapsed = now - startTs;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutExpoAt(t);
      const next = start + delta * eased;
      const rounded = Math.round(next * factor) / factor;
      setValue(rounded);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, factor, prefersReducedMotion]);

  return value;
}
