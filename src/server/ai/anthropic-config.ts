import "server-only";

/**
 * Anthropic API configuration constants — single source of truth for
 * model pinning, base URL, and request budgets.
 *
 * Model resolution (P4r-1 Gate-1 K1):
 *   1. process.env.ANTHROPIC_MODEL if set → use as-is.
 *   2. else fall back to ANTHROPIC_MODEL_DEFAULT.
 *
 * Pin (P4r-7): `claude-sonnet-4-5-20250929` — dated snapshot of Sonnet
 * 4.5. Switched from `claude-sonnet-4-6` after the P4r-6 brain-eval
 * empirically showed:
 *   - Sonnet 4.6's alias does not support prompt caching (cache_create
 *     and cache_read both 0 even on prefixes well above the 1024-token
 *     minimum). Sonnet 4.5 caches normally — ~47% cost reduction
 *     observed across the 11-row eval bank ($0.107 → $0.057).
 *   - No observable quality differentiator between 4.5 and 4.6 on the
 *     bank. Both produced clean MSA, FR, EN replies and both produced
 *     non-Algerian Darija on rows 4–6 (the latter is solved at the
 *     prompt layer in BLOCK_A_TEXT, not the model layer).
 *   - Dated snapshot (not the `claude-sonnet-4-5` alias) so silent
 *     rotation can't drift quality underneath us.
 *
 * The pricing table in `pricing.ts` strips trailing `-YYYYMMDD` snapshots
 * and falls back to the family alias, so the dated pin doesn't require
 * a pricing-table edit. (Sonnet 4.5 and 4.6 share rates as of P4r-7.)
 */

export const ANTHROPIC_MODEL_DEFAULT = "claude-sonnet-4-5-20250929";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/**
 * API version header (`anthropic-version`). Pin so a future server-side
 * default rev never silently changes our request shape.
 */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Per-request HTTP timeout. The request budget includes retries (Gate-1
 * K5: max 3 attempts on 5xx, 1 retry on 429/network). Each individual
 * attempt times out at REQUEST_TIMEOUT_MS; the outer envelope is bounded
 * by REQUEST_TOTAL_BUDGET_MS to prevent retry storms from holding a
 * request handler open longer than the user can tolerate.
 */
export const REQUEST_TIMEOUT_MS = 30_000;
export const REQUEST_TOTAL_BUDGET_MS = 60_000;

/**
 * Conversation-level retry counter cap (Gate-1 K5 addition). When a
 * conversation has accumulated this many cumulative retries across turns
 * without a clean success in between, fail fast. Counter resets on every
 * successful turn. The orchestrator-level enforcement lands in P4r-2;
 * this constant is the source of truth.
 */
export const CONVERSATION_RETRY_CAP = 5;

/**
 * Resolve the model ID to use for this process. Reads
 * `process.env.ANTHROPIC_MODEL` once per call so test code can mutate
 * env between assertions without module-import caching getting in the
 * way.
 */
export function resolveModelId(): string {
  const fromEnv = process.env.ANTHROPIC_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return ANTHROPIC_MODEL_DEFAULT;
}
