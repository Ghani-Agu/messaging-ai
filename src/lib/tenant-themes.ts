import { z } from "zod";

/**
 * Per-tenant accent override. Stored on `Tenant.accentColor` (nullable).
 * The redesign scopes the existing color tokens via a [data-tenant="<slug>"]
 * selector — the global token defaults stay frozen; only the violet accent
 * family is overridden, and only for tenants that opt in.
 *
 * Strict 6-digit hex only. Anything else is rejected so we never inject a
 * malformed value into a generated CSS rule.
 */
export const accentColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Tenant accent must be a 6-digit hex like #RRGGBB.");

export type AccentColor = z.infer<typeof accentColorSchema>;
