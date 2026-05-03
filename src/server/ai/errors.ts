import "server-only";

/**
 * Typed errors for Anthropic API interactions. The orchestrator + route
 * handlers narrow on these to decide what to surface to the user vs. log
 * vs. retry.
 *
 * Mapping (Gate-1 K5):
 *   - 401 / 403          → AnthropicAuthError       (no retry, surface immediately)
 *   - 400                → AnthropicBadRequestError (no retry, our schema bug)
 *   - 429                → AnthropicRateLimitError  (retry once, honor retry-after)
 *   - 500 / 502 / 503    → AnthropicServerError     (retry up to 3x, exponential)
 *   - network / abort    → AnthropicTimeoutError    (retry once)
 *   - tool_use missing   → AnthropicMissingMetadataError (orchestrator forces
 *                                                       LOW_CONFIDENCE escalation,
 *                                                       see Gate-1 E)
 *
 * All concrete errors extend AnthropicError so callers can do a single
 * `instanceof AnthropicError` check at the route boundary.
 */

export abstract class AnthropicError extends Error {
  readonly retryable: boolean;
  /** HTTP status code if the error originated from a response, else undefined. */
  readonly status?: number;

  constructor(message: string, opts: { retryable: boolean; status?: number }) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

export class AnthropicAuthError extends AnthropicError {
  constructor(message: string, status: number) {
    super(message, { retryable: false, status });
  }
}

export class AnthropicBadRequestError extends AnthropicError {
  constructor(message: string) {
    super(message, { retryable: false, status: 400 });
  }
}

export class AnthropicRateLimitError extends AnthropicError {
  /** retry-after header value in seconds, if provided. */
  readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super(message, { retryable: true, status: 429 });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AnthropicServerError extends AnthropicError {
  constructor(message: string, status: number) {
    super(message, { retryable: true, status });
  }
}

export class AnthropicTimeoutError extends AnthropicError {
  constructor(message: string) {
    super(message, { retryable: true });
  }
}

/**
 * Forced tool-use was requested but the response didn't include a tool_use
 * block. Per Gate-1 E, the orchestrator treats this as LOW_CONFIDENCE
 * escalation with `claudeReason = "MISSING_METADATA"`. Per the tool-use
 * refusals decision, end_turn-without-tool-use is also rerouted to
 * OUTSIDE_SCOPE (`claudeReason = "TOOL_REFUSAL"`) — that variant lives in
 * AnthropicToolRefusalError below.
 */
export class AnthropicMissingMetadataError extends AnthropicError {
  constructor(message = "Anthropic response did not include the expected tool_use block") {
    super(message, { retryable: false });
  }
}

/**
 * Claude refused to call the forced tool (e.g., safety filter). Stop reason
 * is end_turn with no tool_use block. Orchestrator escalates as
 * OUTSIDE_SCOPE so the gap-logger picks it up.
 */
export class AnthropicToolRefusalError extends AnthropicError {
  constructor(message = "Anthropic returned end_turn without a tool_use block (refusal)") {
    super(message, { retryable: false });
  }
}
