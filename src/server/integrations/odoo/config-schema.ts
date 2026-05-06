import "server-only";

import { z } from "zod";

/**
 * Decrypted shape of a LiveDataSource.encryptedConfig blob when
 * type === "ODOO". Persisted as a JSON string inside the AES-256-GCM
 * envelope (see src/server/integrations/crypto.ts) — every cleartext
 * field including `password` lives only inside the envelope and the
 * adapter's authentication call.
 *
 * Schema choices:
 * - `url` MUST be HTTPS. Odoo XML-RPC over plain HTTP exposes the
 *   credentials on every request; we refuse to construct a client
 *   over an insecure transport.
 * - `database` is Odoo's database name (typically the host slug for
 *   self-hosted deployments — e.g. "wbp.tayssir-erp.dz" — but can be
 *   any name the operator picks).
 * - `additionalFields.brandField` is the column name on
 *   product.template carrying the brand many2one. Tayssir-wrapped
 *   Odoo uses `marque_id`; stock Odoo uses `brand_id` (if the brand
 *   module is installed) or an operator-defined custom field. Left
 *   optional because not every catalog has a brand axis.
 */
export const OdooConfigSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "Must use HTTPS"),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  additionalFields: z
    .object({
      brandField: z.string().optional(),
    })
    .optional(),
});

export type OdooConfig = z.infer<typeof OdooConfigSchema>;
