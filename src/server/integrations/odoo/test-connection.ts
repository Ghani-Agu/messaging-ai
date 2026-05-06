import "server-only";

import { OdooClient } from "./client";
import type { OdooConfig } from "./config-schema";

/**
 * Pure pre-flight check used by the Connect modal's "Test connection"
 * button and by the Server Action that gates initial save. NO side
 * effects — does not write to the DB, does not enqueue a sync. Returns
 * a discriminated union so the caller can show a rich success state
 * (sample product + total count) or a typed error message.
 *
 * The error message intentionally contains only the upstream's
 * surfaced text — never the config object, never the password. Errors
 * thrown by the OdooClient already follow this rule by construction.
 */
export type TestOdooConnectionResult =
  | {
      ok: true;
      sampleProduct: { id: number; name: string };
      productCount: number;
    }
  | { ok: false; error: string };

export async function testOdooConnection(
  config: OdooConfig,
): Promise<TestOdooConnectionResult> {
  try {
    const client = new OdooClient(config);
    await client.authenticate();
    const products = await client.searchRead<{ id: number; name: string }>(
      "product.template",
      [
        ["sale_ok", "=", true],
        ["active", "=", true],
      ],
      ["id", "name"],
      { limit: 1 },
    );
    if (products.length === 0) {
      return {
        ok: false,
        error:
          "Connected but no sellable products found. Check user permissions.",
      };
    }
    const count = await client.executeKw<number>(
      "product.template",
      "search_count",
      [
        [
          ["sale_ok", "=", true],
          ["active", "=", true],
        ],
      ],
    );
    const first = products[0];
    if (!first) {
      // Shouldn't happen — products.length === 0 was already returned
      // above — but the noUncheckedIndexedAccess strictness wants the
      // explicit guard.
      return {
        ok: false,
        error: "Connected but product list returned an empty first row.",
      };
    }
    return {
      ok: true,
      sampleProduct: first,
      productCount: count,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
