import "server-only";

/**
 * Public surface for the Odoo adapter. Anything outside this folder
 * imports from "@/server/integrations/odoo" — never from the leaf
 * files directly.
 */

export { OdooClient, withRetry, redactConfig } from "./client";
export { syncOdooProducts, type SyncResult } from "./sync";
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
