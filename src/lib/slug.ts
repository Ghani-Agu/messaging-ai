import { z } from "zod";

/**
 * URL paths reserved by the platform. Any of these as a tenant slug would
 * collide with a top-level route, so we forbid them at validation time.
 * Add new entries here whenever a new top-level route lands.
 */
const RESERVED_SLUGS = new Set<string>([
  "_next",
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "dashboard",
  "favicon.ico",
  "login",
  "logout",
  "marketing",
  "onboarding",
  "post-auth",
  "public",
  "settings",
  "signup",
  "static",
  "verify-request",
  "widget",
  "www",
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Workspace URL must be at least 2 characters.")
  .max(32, "Workspace URL must be 32 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens only.",
  )
  .refine((s) => !RESERVED_SLUGS.has(s), "That workspace URL is reserved.");

export const tenantNameSchema = z
  .string()
  .trim()
  .min(1, "Workspace name is required.")
  .max(64, "Workspace name must be 64 characters or fewer.");

/**
 * Best-effort slug derivation from a free-text workspace name. Strips
 * accents, lowercases, replaces non-alphanumerics with hyphens, trims
 * leading/trailing hyphens, and clamps length. Output is not guaranteed
 * to pass slugSchema (e.g. names made entirely of punctuation produce
 * an empty string) — UX should validate before submit.
 */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
