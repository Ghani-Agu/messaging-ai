/**
 * Generate widget/src/tokens.ts from src/lib/design-tokens.ts.
 *
 * The widget is a standalone Vite build that cannot reach `src/`, so the
 * tokens are physically duplicated. This script is the single seam that
 * keeps the duplicate in sync — every drift is surfaced at build time
 * (widget:check-tokens) and at commit time (simple-git-hooks pre-commit).
 *
 * Usage:
 *   npx tsx scripts/generate-widget-tokens.ts          # write
 *   npx tsx scripts/generate-widget-tokens.ts --check  # exit 1 if stale
 *
 * IMPORTANT: do not edit widget/src/tokens.ts by hand. Edit
 * src/lib/design-tokens.ts then re-run this script.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  colors,
  radii,
  shadows,
} from "../src/lib/design-tokens";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "widget", "src", "tokens.ts");

const HEADER = `/* AUTO-GENERATED — do not edit by hand.
 * Source: src/lib/design-tokens.ts
 * Regenerate: npx tsx scripts/generate-widget-tokens.ts
 *
 * The widget builds in isolation and cannot import from the main app, so
 * tokens are mirrored here. Drift is caught by:
 *   - the pre-commit hook (simple-git-hooks → widget:check-tokens)
 *   - the widget build (npm run widget:build runs the same check first)
 */
`;

// Motion + radius + select shadow + accent + status are all the widget
// uses. Keep this surface narrow: the widget should not depend on
// anything that doesn't render in a chat panel.
const motion = {
  easeStandard: "cubic-bezier(0.4, 0, 0.2, 1)",
  easeOutExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  durationFast: "150ms",
  durationMedium: "250ms",
  durationSlow: "400ms",
} as const;

const tokens = {
  bg: colors.bg,
  border: { subtle: colors.border.subtle, default: colors.border.default, strong: colors.border.strong },
  text: colors.text,
  accent: { base: colors.accent.base, hover: colors.accent.hover, active: colors.accent.active, glow: colors.accent.glow },
  status: colors.semantic,
  radius: { sm: radii.sm, md: radii.md, lg: radii.lg, xl: radii.xl, full: radii.full },
  shadow: { md: shadows.md, lg: shadows.lg, glow: shadows.glow },
  motion,
} as const;

const body = `${HEADER}
export const tokens = ${JSON.stringify(tokens, null, 2)} as const;
`;

const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  if (!existsSync(outPath)) {
    console.error(`✗ ${outPath} missing — run scripts/generate-widget-tokens.ts to create it`);
    process.exit(1);
  }
  const current = readFileSync(outPath, "utf8");
  if (current !== body) {
    console.error(
      "✗ widget/src/tokens.ts is stale.\n" +
        "  Run: npx tsx scripts/generate-widget-tokens.ts\n" +
        "  Then commit the regenerated file.",
    );
    process.exit(1);
  }
  console.log("✓ widget/src/tokens.ts up to date");
} else {
  writeFileSync(outPath, body);
  console.log(`✓ wrote ${outPath}`);
}
