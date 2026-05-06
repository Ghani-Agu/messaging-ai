import "server-only";

/**
 * Public surface for the Odoo adapter. Anything outside this folder
 * imports from "@/server/integrations/odoo" — never from the leaf
 * files directly.
 *
 * Note: syncOdooProducts lands in the Commit 3 follow-up. This barrel
 * intentionally does NOT re-export it yet — adding the export here in
 * Commit 2 would break TS resolution because the file doesn't exist.
 * The dispatch.ts switch in Commit 3 imports it directly from
 * `./odoo/sync` rather than going through the barrel, then the barrel
 * gains the re-export in the same Commit 3 patch.
 */

export { OdooClient, withRetry, redactConfig } from "./client";
export {
  testOdooConnection,
  type TestOdooConnectionResult,
} from "./test-connection";
export { OdooConfigSchema, type OdooConfig } from "./config-schema";
export {
  OdooProductTemplateSchema,
  Many2oneSchema,
  type OdooProductTemplate,
  type Many2one,
} from "./models";
