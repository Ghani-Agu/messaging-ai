/**
 * Shared Zod schemas. Keep tenant-shaped validators here; per-feature schemas
 * live with their feature in src/server/<area>/.
 */
import { z } from "zod";

export const tenantSlugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Lowercase letters, digits, hyphens");

export type TenantSlug = z.infer<typeof tenantSlugSchema>;
