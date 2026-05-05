import "server-only";

import type { ReactNode } from "react";
import { accentColorSchema } from "@/lib/tenant-themes";

/**
 * Per-tenant theme scope. Wraps the operator-app subtree in a div carrying
 * `data-tenant="<slug>"`, and (when accentColor is set + valid) emits a
 * scoped <style> block that overrides the violet accent family for this
 * tenant only. Global token defaults are frozen — this is the single
 * sanctioned override surface.
 *
 * Tokens overridden:
 *   --accent-base / --accent-hover / --accent-active / --accent-glow
 *   --gradient-primary  (rebuilt against the new accent + cyan secondary)
 *
 * Light theme picks up the same overrides because `[data-tenant=...]` is
 * a different selector axis from `[data-theme=light|dark]`.
 *
 * Invalid `accentColor` values are logged and skipped (no override).
 */
export function TenantThemeProvider({
  slug,
  accentColor,
  children,
}: {
  slug: string;
  accentColor: string | null;
  children: ReactNode;
}) {
  if (!accentColor) {
    return <div data-tenant={slug}>{children}</div>;
  }

  const parsed = accentColorSchema.safeParse(accentColor);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "invalid accent color";
    console.warn(
      `[tenant-theme-warn] tenant=${slug} accentColor=${accentColor} ${message} — falling back to default theme`,
    );
    return <div data-tenant={slug}>{children}</div>;
  }

  // The selector is namespaced by slug, so per-tenant CSS variables only
  // apply inside this subtree. dangerouslySetInnerHTML is safe here: `slug`
  // comes from the URL/DB after auth resolution, and `parsed.data` was just
  // validated against the strict 6-digit hex regex — neither can carry CSS
  // syntax that escapes the rule.
  const accent = parsed.data;
  const css = `[data-tenant="${slug}"] {
  --accent-base: ${accent};
  --accent-hover: color-mix(in oklab, ${accent} 88%, white);
  --accent-active: color-mix(in oklab, ${accent} 88%, black);
  --accent-glow: color-mix(in srgb, ${accent} 35%, transparent);
  --gradient-primary: linear-gradient(135deg, ${accent} 0%, var(--accent-secondary) 100%);
}`;

  return (
    <>
      <style data-tenant-theme={slug} dangerouslySetInnerHTML={{ __html: css }} />
      <div data-tenant={slug}>{children}</div>
    </>
  );
}
