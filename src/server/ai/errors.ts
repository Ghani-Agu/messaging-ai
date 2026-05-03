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
  /**
   * Number of retries the failing call used before giving up. Set by the
   * RealClaudeClient retry loop right before throw. Used by the
   * orchestrator's per-conversation retry-budget tracker (Gate-1 K5).
   */
  retriesUsed = 0;

  constructor(message: string, opts: { retryable: boolean; status?: number }) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

/**
 * Conversation-level retry budget exhausted (Gate-1 K5 addition). Thrown
 * by the orchestrator when per-conversation cumulative retries would
 * exceed CONVERSATION_RETRY_CAP. No more API calls for this conversation
 * until a turn succeeds cleanly with 0 retries.
 */
export class AnthropicConversationBudgetExhaustedError extends AnthropicError {
  constructor(retriesUsed: number, cap: number) {
    super(
      `conversation retry budget exhausted (${retriesUsed}/${cap})`,
      { retryable: false },
    );
    this.retriesUsed = retriesUsed;
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
 * P4r-3: Claude emitted natural-content reply text but the forced
 * send_reply_metadata tool_use block was missing. The reply is usable
 * (we surface it to the customer), but we have no self-reported
 * groundedness / citations / escalation signal — orchestrator forces
 * escalation = LOW_CONFIDENCE with claudeReason = "MISSING_METADATA".
 *
 * Carries reply text + usage so the orchestrator can persist the partial
 * response and emit [brain-cost] for the call that actually happened.
 */
export class AnthropicMissingMetadataError extends AnthropicError {
  readonly replyText: string;
  readonly modelId: string;
  readonly usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  } | null;
  constructor(args: {
    replyText: string;
    modelId: string;
    usage:
      | {
          inputTokens: number;
          outputTokens: number;
          cacheCreationInputTokens?: number;
          cacheReadInputTokens?: number;
        }
      | null;
    message?: string;
  }) {
    super(
      args.message ??
        "Anthropic response had reply text but missing send_reply_metadata tool_use block",
      { retryable: false },
    );
    this.replyText = args.replyText;
    this.modelId = args.modelId;
    this.usage = args.usage;
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
