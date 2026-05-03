import "server-only";

/**
 * Anthropic pricing — single source of truth for cost computation.
 *
 * Numbers are USD per 1 MILLION tokens. Source: anthropic.com/pricing.
 * Last verified: 2026-05-03.
 *
 * Pricing structure for cached input tokens:
 *   - cache write (5-min TTL):   input × 1.25
 *   - cache write (1-hour TTL):  input × 2.00  (paid feature)
 *   - cache read:                input × 0.10  (90% discount)
 *
 * We use 5-min ephemeral cache only (Gate-1 K3); 1-hour write multiplier
 * is documented for completeness but never charged.
 *
 * If Anthropic changes pricing, update CLAUDE_PRICING below + bump the
 * "last verified" date. Never read pricing from a remote feed at runtime
 * — the dollar fields end up on Message.aiMetadata and we want them stable
 * for any given historical row.
 */

export type PricingPerMillion = {
  /** Plain-input cost per 1M input tokens, USD. */
  input: number;
  /** Output cost per 1M output tokens, USD. */
  output: number;
  /** Cost per 1M tokens written to the 5-min ephemeral cache. */
  cacheWrite5m: number;
  /** Cost per 1M tokens written to the 1-hour cache (paid; unused in v1). */
  cacheWrite1h: number;
  /** Cost per 1M tokens read from cache. */
  cacheRead: number;
};

/**
 * Per-model pricing table. Keyed by Anthropic model ID. The lookup falls
 * back to a *family* match for dated snapshots (`claude-sonnet-4-6-...`)
 * so a future dated pin still resolves to Sonnet 4.6 pricing.
 */
const CLAUDE_PRICING: Record<string, PricingPerMillion> = {
  // Sonnet family — pricing identical for 4.5 and 4.6 at time of writing.
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  "claude-sonnet-4-5": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  // Haiku family (cheaper, future use).
  "claude-haiku-4-5": {
    input: 1.0,
    output: 5.0,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
  },
  // Opus family (more expensive, future use).
  "claude-opus-4-7": {
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },
  "claude-opus-4-6": {
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },
};

/**
 * Resolve pricing for a model ID. Tries exact match first, then strips a
 * trailing `-YYYYMMDD` snapshot suffix and retries against the family
 * alias. Throws if no pricing is registered — we want the failure loud
 * (silent zero-cost is worse than a crash) so an operator notices when a
 * new model lands and pricing wasn't updated.
 */
export function getPricing(modelId: string): PricingPerMillion {
  const direct = CLAUDE_PRICING[modelId];
  if (direct) return direct;
  // Strip a dated suffix like "-20260217" and retry.
  const family = modelId.replace(/-\d{8}$/, "");
  const familyMatch = CLAUDE_PRICING[family];
  if (familyMatch) return familyMatch;
  throw new Error(
    `pricing.ts: no pricing registered for model "${modelId}" — add it to CLAUDE_PRICING`,
  );
}

export type UsageBreakdown = {
  /** Plain (uncached) input tokens. */
  inputTokens: number;
  /** Output tokens generated. */
  outputTokens: number;
  /** Tokens written to the 5-min ephemeral cache (incurs +25% surcharge). */
  cacheCreationInputTokens?: number;
  /** Tokens served from cache (90% discount). */
  cacheReadInputTokens?: number;
};

/**
 * Compute USD cost from a usage breakdown. Returns the precise dollar
 * amount (typically a few cents per call); callers can format for display.
 *
 * Math:
 *   cost = (inputTokens         * input        / 1M)
 *        + (outputTokens        * output       / 1M)
 *        + (cacheWriteTokens    * cacheWrite5m / 1M)
 *        + (cacheReadTokens     * cacheRead    / 1M)
 *
 * Note: when prompt caching is active, Anthropic returns three buckets
 * separately:
 *   - input_tokens                  → plain-input fraction (uncached prefix
 *                                     and non-cached suffix combined)
 *   - cache_creation_input_tokens  → tokens written to the cache this call
 *   - cache_read_input_tokens      → tokens served from cache
 * The sum of all three == total input tokens for the request.
 *
 * Each bucket has its own per-token rate; we sum the four products.
 */
export function computeCostUsd(
  modelId: string,
  usage: UsageBreakdown,
): number {
  const p = getPricing(modelId);
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cost =
    (usage.inputTokens * p.input) / 1_000_000 +
    (usage.outputTokens * p.output) / 1_000_000 +
    (cacheWrite * p.cacheWrite5m) / 1_000_000 +
    (cacheRead * p.cacheRead) / 1_000_000;
  return cost;
}

/**
 * Format a USD amount for log lines. Six decimals for sub-cent precision —
 * a typical Sonnet call lands around $0.001–$0.020.
 */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(6)}`;
}
