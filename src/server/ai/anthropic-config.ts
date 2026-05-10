import "server-only";

/**
 * Anthropic API configuration constants — single source of truth for
 * model pinning, base URL, and request budgets.
 *
 * Model resolution (P4r-1 Gate-1 K1):
 *   1. process.env.ANTHROPIC_MODEL if set → use as-is.
 *   2. else fall back to ANTHROPIC_MODEL_DEFAULT.
 *
 * Pin (P4r-8): `claude-sonnet-4-6` — dateless alias for Sonnet 4.6
 * (Feb 2026 release). Re-upgraded from `claude-sonnet-4-5-20250929`
 * for modestly better instruction-following + source-information
 * accuracy per Anthropic's published benchmarks. No code structural
 * changes — single constant updated; pricing already covered (same
 * $3/$15 per MTok as Sonnet 4.5).
 *
 * Caveat to re-validate after the upgrade lands (CLAUDE.md §7a P4r-7
 * historical note): the prior P4r-6 brain-eval observed the 4.6 alias
 * silently disabled prompt caching (cache_create=0 / cache_read=0
 * on prefixes well above the 1024-token Sonnet minimum). That
 * observation may be stale — re-run `npm run probe:cache` after this
 * lands. If caching still doesn't fire, we either accept the cost
 * (~47% higher than 4.5 per the prior eval) or pin back to 4.5.
 *
 * Dated handles: a prior P4r-2 probe rejected `claude-sonnet-4-6-
 * 20260217` (404 from /v1/messages). When a real dated snapshot
 * becomes available, override via ANTHROPIC_MODEL env or update the
 * default here — the pricing table already strips trailing dates and
 * falls back to the `claude-sonnet-4-6` family entry, so no pricing
 * edit needed.
 */

export const ANTHROPIC_MODEL_DEFAULT = "claude-sonnet-4-6";

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
