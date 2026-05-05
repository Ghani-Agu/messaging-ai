/**
 * Design tokens as TypeScript constants — for any code path that can't reach
 * CSS variables (Framer Motion `style`, canvas, JS-driven animations, etc.).
 *
 * Source of truth: MASTER_PLAN.md §4. The CSS-side definitions live in
 * src/app/globals.css. Keep these two in sync.
 */

export const colors = {
  bg: {
    base: "#0A0A0B",
    surface: "#111113",
    surfaceElevated: "#18181B",
    surfaceOverlay: "#1F1F23",
  },
  border: {
    subtle: "#1F1F23",
    default: "#27272A",
    strong: "#3F3F46",
  },
  text: {
    primary: "#FAFAFA",
    secondary: "#A1A1AA",
    tertiary: "#71717A",
    disabled: "#52525B",
  },
  accent: {
    base: "#EA580C",
    hover: "#F97316",
    active: "#C2410C",
    glow: "rgba(234, 88, 12, 0.35)",
    secondary: "#06B6D4",
  },
  semantic: {
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
  },
} as const;

export const radii = {
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  "2xl": "24px",
  full: "9999px",
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.4)",
  md: "0 4px 12px rgba(0,0,0,0.5)",
  lg: "0 12px 32px rgba(0,0,0,0.55)",
  glow: `0 0 32px ${colors.accent.glow}`,
  glowStrong: `0 0 64px ${colors.accent.glow}, 0 0 16px ${colors.accent.glow}`,
} as const;

export const typography = {
  display: { size: "3.5rem", lineHeight: 1.05, weight: 700 },
  h1: { size: "2.5rem", lineHeight: 1.1, weight: 600 },
  h2: { size: "2rem", lineHeight: 1.15, weight: 600 },
  h3: { size: "1.5rem", lineHeight: 1.2, weight: 600 },
  h4: { size: "1.25rem", lineHeight: 1.3, weight: 500 },
  bodyLg: { size: "1.125rem", lineHeight: 1.55, weight: 400 },
  body: { size: "0.9375rem", lineHeight: 1.6, weight: 400 },
  bodySm: { size: "0.8125rem", lineHeight: 1.55, weight: 400 },
  caption: { size: "0.75rem", lineHeight: 1.4, weight: 400 },
} as const;

export const gradients = {
  primary: "linear-gradient(135deg, #EA580C 0%, #06B6D4 100%)",
  mesh:
    "radial-gradient(at 27% 37%, hsla(20,90%,55%,0.18) 0px, transparent 50%)," +
    "radial-gradient(at 97% 21%, hsla(189,75%,55%,0.12) 0px, transparent 50%)," +
    "radial-gradient(at 52% 99%, hsla(15,90%,55%,0.10) 0px, transparent 50%)",
} as const;
