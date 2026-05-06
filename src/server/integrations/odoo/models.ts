import "server-only";

import { z } from "zod";

/**
 * Typed shapes for Odoo XML-RPC responses on `product.template`.
 *
 * Odoo's wire quirks (these are NOT typos — they're the documented
 * conventions of Odoo's XML-RPC layer):
 *
 *  1. Many2one fields come back as `[id, "Display Name"]` tuples or
 *     `false` when unset.
 *  2. Optional CHAR / TEXT fields come back as `false` (the boolean
 *     literal) when unset, NOT null or empty string. Schemas must
 *     therefore accept `string | false` and the caller decides how to
 *     map `false` to `null` for downstream storage.
 *  3. Datetime fields are space-separated strings, not ISO-8601
 *     ("2026-05-06 12:34:56"), in Odoo's server timezone (configurable;
 *     defaults to UTC). Sync logic converts these at the write site.
 *
 * The schema is `passthrough` so vendor-specific custom columns
 * (e.g. Tayssir's `marque_id`) don't get stripped at parse time —
 * the sync adapter reads them off the raw record using the
 * additionalFields config.
 */

export const Many2oneSchema = z.tuple([z.number(), z.string()]).nullable();
export type Many2one = z.infer<typeof Many2oneSchema>;

export const OdooProductTemplateSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    default_code: z.union([z.string(), z.literal(false)]).nullable(),
    list_price: z.number(),
    standard_price: z.number(),
    qty_available: z.number(),
    virtual_available: z.number(),
    categ_id: Many2oneSchema,
    type: z.enum(["product", "service", "consu"]),
    sale_ok: z.boolean(),
    active: z.boolean(),
    write_date: z.string(),
    barcode: z.union([z.string(), z.literal(false)]).nullable().optional(),
    description_sale: z
      .union([z.string(), z.literal(false)])
      .nullable()
      .optional(),
  })
  .passthrough();

export type OdooProductTemplate = z.infer<typeof OdooProductTemplateSchema>;
