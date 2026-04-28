/* AUTO-GENERATED — do not edit by hand.
 * Source: src/lib/design-tokens.ts
 * Regenerate: npx tsx scripts/generate-widget-tokens.ts
 *
 * The widget builds in isolation and cannot import from the main app, so
 * tokens are mirrored here. Drift is caught by:
 *   - the pre-commit hook (simple-git-hooks → widget:check-tokens)
 *   - the widget build (npm run widget:build runs the same check first)
 */

export const tokens = {
  "bg": {
    "base": "#0A0A0B",
    "surface": "#111113",
    "surfaceElevated": "#18181B",
    "surfaceOverlay": "#1F1F23"
  },
  "border": {
    "subtle": "#1F1F23",
    "default": "#27272A",
    "strong": "#3F3F46"
  },
  "text": {
    "primary": "#FAFAFA",
    "secondary": "#A1A1AA",
    "tertiary": "#71717A",
    "disabled": "#52525B"
  },
  "accent": {
    "base": "#7C3AED",
    "hover": "#8B5CF6",
    "active": "#6D28D9",
    "glow": "rgba(124, 58, 237, 0.35)"
  },
  "status": {
    "success": "#10B981",
    "warning": "#F59E0B",
    "danger": "#EF4444"
  },
  "radius": {
    "sm": "6px",
    "md": "8px",
    "lg": "12px",
    "xl": "16px",
    "full": "9999px"
  },
  "shadow": {
    "md": "0 4px 12px rgba(0,0,0,0.5)",
    "lg": "0 12px 32px rgba(0,0,0,0.55)",
    "glow": "0 0 32px rgba(124, 58, 237, 0.35)"
  },
  "motion": {
    "easeStandard": "cubic-bezier(0.4, 0, 0.2, 1)",
    "easeOutExpo": "cubic-bezier(0.16, 1, 0.3, 1)",
    "durationFast": "150ms",
    "durationMedium": "250ms",
    "durationSlow": "400ms"
  }
} as const;
