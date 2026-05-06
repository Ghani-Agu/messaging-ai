import "server-only";

import xmlrpc from "xmlrpc";
import type { OdooConfig } from "./config-schema";

/**
 * XML-RPC client for Odoo 13+. Implements the two-step Odoo
 * authentication dance:
 *
 *   1. POST /xmlrpc/2/common with `authenticate(db, user, pw, {})`
 *      → returns a numeric uid (or `false` on failure).
 *   2. POST /xmlrpc/2/object with `execute_kw(db, uid, pw, model,
 *      method, args, kwargs)` for every actual call thereafter.
 *
 * Production-grade choices:
 *  - 30s timeout per call. Odoo can be slow on cold starts and on
 *    large `search_count` queries; longer than the default would
 *    block the cron route too long, shorter would fail under
 *    legitimate load.
 *  - Single retry on network errors. Not on auth errors — those
 *    indicate a bad password, retrying just amplifies a lockout
 *    risk if Odoo is configured with one.
 *  - HTTPS-only at construction time (enforced by OdooConfigSchema).
 *  - **Never log the config**. The redactConfig helper exists for
 *    the cases where contextual logging is genuinely needed; even
 *    then, password is omitted by construction.
 */

const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_000;

type XmlRpcClient = ReturnType<typeof xmlrpc.createSecureClient>;

/**
 * Promise-wraps xmlrpc's callback-based methodCall and adds an explicit
 * timeout. xmlrpc's underlying HTTP layer respects neither the standard
 * `signal` API nor a per-call timeout option — the timeout has to live
 * here, in the wrapper. We do NOT cancel the underlying request when the
 * timeout fires (xmlrpc has no API for it); the dangling socket cleans
 * up via Node's keepalive timeout. Acceptable trade-off for a worker
 * making at most a handful of calls per sync.
 */
function callXmlRpc<T>(
  client: XmlRpcClient,
  method: string,
  params: unknown[],
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`XML-RPC call timed out after ${TIMEOUT_MS}ms: ${method}`));
    }, TIMEOUT_MS);
    // The xmlrpc types declare `params: any[]` and the callback signature
    // with the upper-cased `Object` / `any` — we bridge to typed unknown
    // at the boundary. The cast on the callback is the only place this
    // file touches xmlrpc's loose typing.
    const callback = (err: unknown, value: unknown): void => {
      clearTimeout(timeout);
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(value as T);
    };
    client.methodCall(
      method,
      params as unknown[],
      callback as (err: object, value: unknown) => void,
    );
  });
}

/**
 * Heuristic: does this error indicate a credential / auth problem (vs a
 * network blip)? Used by withRetry() to decide whether to back off and
 * retry. Auth errors are surfaced immediately so the operator sees a
 * clear "wrong password" rather than two identical retries.
 *
 * We match on the message because xmlrpc surfaces XML-RPC faults as
 * generic Error instances with the upstream fault string baked in. The
 * Odoo-side fault strings for auth failures are stable (`AccessDenied`
 * is the docs-mandated server-side signal).
 */
function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    const m = err.message;
    if (/AccessDenied/i.test(m)) return true;
    if (/Authenticat/i.test(m)) return true;
    if (/invalid credentials/i.test(m)) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isAuthError(err)) throw err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

/**
 * Strip the config of secret-bearing fields so it can appear in
 * structured logs / error contexts without leaking the password. NEVER
 * call console.log on the raw config; always pass it through this.
 */
export function redactConfig(config: OdooConfig): Record<string, unknown> {
  return {
    url: config.url,
    database: config.database,
    username: config.username,
    additionalFields: config.additionalFields,
    // password intentionally omitted
  };
}

export class OdooClient {
  private uid: number | null = null;

  constructor(private readonly config: OdooConfig) {}

  /**
   * Resolve the operator's uid via /xmlrpc/2/common authenticate.
   * Returns the numeric uid on success; throws on failure. Caches the
   * uid for subsequent executeKw calls within the same OdooClient
   * instance.
   */
  async authenticate(): Promise<number> {
    const common = xmlrpc.createSecureClient({
      url: `${this.config.url}/xmlrpc/2/common`,
    });
    const result = await withRetry(() =>
      callXmlRpc<number | false>(common, "authenticate", [
        this.config.database,
        this.config.username,
        this.config.password,
        {},
      ]),
    );
    if (typeof result !== "number" || result === 0) {
      throw new Error(
        "Odoo authentication failed: invalid credentials or database name",
      );
    }
    this.uid = result;
    return result;
  }

  /**
   * Generic execute_kw wrapper. Lazily authenticates on first call;
   * subsequent calls reuse the cached uid. Each call opens a fresh
   * XML-RPC client (xmlrpc's keepalive is unreliable across long-lived
   * processes — we trade socket reuse for predictability).
   */
  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {},
  ): Promise<T> {
    if (this.uid === null) await this.authenticate();
    const object = xmlrpc.createSecureClient({
      url: `${this.config.url}/xmlrpc/2/object`,
    });
    return withRetry(() =>
      callXmlRpc<T>(object, "execute_kw", [
        this.config.database,
        this.uid,
        this.config.password,
        model,
        method,
        args,
        kwargs,
      ]),
    );
  }

  /**
   * Convenience wrapper for the common search_read pattern. Default
   * limit of 200 matches the sync worker's PAGE_SIZE.
   */
  async searchRead<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    options: { limit?: number; offset?: number } = {},
  ): Promise<T[]> {
    return this.executeKw<T[]>(model, "search_read", [domain], {
      fields,
      limit: options.limit ?? 200,
      offset: options.offset ?? 0,
    });
  }
}
