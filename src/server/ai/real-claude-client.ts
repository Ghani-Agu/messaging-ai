import "server-only";
// CLAUDE.md §6 carve-out (Gate-1 K2): the worker rule (no third-party
// HTTP-client SDKs) applies to long-lived BullMQ workers, not request-
// scoped Next.js route handlers / Server Actions. RealClaudeClient is
// only ever consumed via runBrain (widget route) and structureItemsFromText
// (Server Action). It must NEVER be imported by scripts/worker.ts.
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import {
  ANTHROPIC_API_VERSION,
  REQUEST_TIMEOUT_MS,
  REQUEST_TOTAL_BUDGET_MS,
  resolveModelId,
} from "./anthropic-config";
import {
  SEND_REPLY_TOOL,
  type ClaudeClient,
  type SendReplyArgs,
  type SendReplyResult,
  type SendReplyToolArgs,
  type StructureItemsArgs,
  type StructureItemsResult,
} from "./claude-client";
import {
  AnthropicAuthError,
  AnthropicBadRequestError,
  AnthropicError,
  AnthropicRateLimitError,
  AnthropicServerError,
  AnthropicTimeoutError,
  AnthropicToolRefusalError,
} from "./errors";

/**
 * RealClaudeClient — production implementation of ClaudeClient backed by
 * the official @anthropic-ai/sdk. Conforms to the same shape as
 * StubClaudeClient so the orchestrator can swap them at the
 * getClaudeClient() factory.
 *
 * P4r-2 ships sendReply only. streamReply lands in P4r-4.
 * structureItemsFromText (smart-import) lands in P4r-5.
 *
 * Retry policy (Gate-1 K5):
 *   - 401/403           → AnthropicAuthError, no retry.
 *   - 400               → AnthropicBadRequestError, no retry.
 *   - 429               → AnthropicRateLimitError; retry ONCE; honor
 *                         retry-after header (default 1s + jitter).
 *   - 500/502/503/504   → AnthropicServerError; up to 3 attempts;
 *                         exponential 500ms → 2s → 8s.
 *   - network / timeout → AnthropicTimeoutError; retry ONCE @ 1s.
 *   - end_turn no tool  → AnthropicToolRefusalError, no retry.
 *   - other             → bubbled up as the SDK's native error.
 *
 * Per-attempt timeout: REQUEST_TIMEOUT_MS (30s).
 * Total budget across retries: REQUEST_TOTAL_BUDGET_MS (60s) — enforced
 * before each retry; throws AnthropicTimeoutError if exceeded.
 *
 * Conversation-level retry-budget cap (Gate-1 K5 addition): handled by
 * the orchestrator. This client reports `retriesUsed` per call so the
 * orchestrator can accumulate.
 */

const SEND_REPLY_TEMPERATURE = 0.6;

const RETRY_BACKOFF_MS = [500, 2_000, 8_000] as const;
const FIVE_XX_MAX_ATTEMPTS = 3;

type SystemBlockSdk = Anthropic.TextBlockParam;

export type RealClaudeClientOptions = {
  apiKey: string;
  modelId?: string;
};

export class RealClaudeClient implements ClaudeClient {
  private readonly client: Anthropic;
  private readonly modelId: string;

  constructor(opts: RealClaudeClientOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      defaultHeaders: { "anthropic-version": ANTHROPIC_API_VERSION },
    });
    this.modelId = opts.modelId ?? resolveModelId();
  }

  async sendReply(args: SendReplyArgs): Promise<SendReplyResult> {
    return this.withRetry(async () => this.sendReplyOnce(args));
  }

  /**
   * Single attempt. Maps SDK errors to our typed errors so the retry
   * dispatcher can branch off `instanceof AnthropicError` without
   * cracking SDK internals.
   */
  private async sendReplyOnce(args: SendReplyArgs): Promise<SendReplyResult> {
    const systemBlocks = mapSystemBlocks(args.system);
    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.modelId,
          max_tokens: args.maxTokens,
          temperature: SEND_REPLY_TEMPERATURE,
          system: systemBlocks,
          tools: [SEND_REPLY_TOOL as unknown as Anthropic.Tool],
          tool_choice: { type: "tool", name: SEND_REPLY_TOOL.name },
          messages: [{ role: "user", content: args.userMessage }],
        },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (err) {
      throw mapSdkError(err);
    }

    const toolBlock = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock =>
        b.type === "tool_use" && b.name === SEND_REPLY_TOOL.name,
    );

    // end_turn with no tool_use block → safety / refusal path.
    if (!toolBlock) {
      throw new AnthropicToolRefusalError();
    }

    const toolArgs = toolBlock.input as SendReplyToolArgs;
    const usage = response.usage;
    return {
      toolArgs,
      modelId: response.model,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
      },
      // Filled in by withRetry on its way out.
      retriesUsed: 0,
    };
  }

  // structureItemsFromText lands in P4r-5. Defining the slot here so the
  // interface stays explicit; throws until the implementation lands.
  async structureItemsFromText(_args: StructureItemsArgs): Promise<StructureItemsResult> {
    throw new Error(
      "RealClaudeClient.structureItemsFromText: not implemented yet (lands in P4r-5)",
    );
  }

  /**
   * Retry loop. Each attempt is gated by the total time budget. retriesUsed
   * is the number of *retries* (not attempts) — first attempt with no
   * retries === retriesUsed=0.
   */
  private async withRetry<T extends { retriesUsed: number }>(
    fn: () => Promise<T>,
  ): Promise<T> {
    const startMs = Date.now();
    let retriesUsed = 0;

    // Loop forever; every path in the body either returns or throws.
    for (;;) {
      // Budget guard before every attempt (including the first — the
      // orchestrator may have spent time embedding the query).
      const elapsed = Date.now() - startMs;
      if (elapsed > REQUEST_TOTAL_BUDGET_MS) {
        const out = new AnthropicTimeoutError(
          `total request budget exceeded after ${elapsed}ms (${retriesUsed} retries)`,
        );
        out.retriesUsed = retriesUsed;
        throw out;
      }

      try {
        const r = await fn();
        return { ...r, retriesUsed };
      } catch (err) {
        // Preserve typed errors from sendReplyOnce; convert anything else.
        const typed = err instanceof AnthropicError ? err : mapSdkError(err);

        const decision = decideRetry(typed, retriesUsed);
        if (!decision.retry) {
          typed.retriesUsed = retriesUsed;
          throw typed;
        }

        retriesUsed += 1;
        const sleepMs = decision.delayMs;
        if (Date.now() - startMs + sleepMs > REQUEST_TOTAL_BUDGET_MS) {
          // Don't sleep past the budget; throw now.
          typed.retriesUsed = retriesUsed - 1;
          throw typed;
        }
        await sleep(sleepMs);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapSystemBlocks(blocks: SendReplyArgs["system"]): SystemBlockSdk[] {
  // Block A/B currently land here as plain text blocks. cache_control
  // markers wire in P4r-3.
  return blocks.map((b) => ({ type: "text" as const, text: b.text }));
}

/**
 * Map an SDK error (any unknown thrown thing) to our typed AnthropicError
 * hierarchy. Branches on the SDK's APIError subclasses where possible;
 * otherwise duck-types on `status` / `name`.
 */
function mapSdkError(err: unknown): AnthropicError {
  if (err instanceof AnthropicError) return err;

  // Anthropic SDK errors expose `.status` and a name like APIError /
  // RateLimitError / etc. Fall back to message-based detection if the SDK
  // ever changes its taxonomy.
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    const headers = ((err as unknown as { headers?: Record<string, string> }).headers) ?? {};
    if (status === 401 || status === 403) {
      return new AnthropicAuthError(`Anthropic auth error (${status}): ${err.message}`, status);
    }
    if (status === 400) {
      return new AnthropicBadRequestError(`Anthropic bad request: ${err.message}`);
    }
    if (status === 429) {
      const retryAfterRaw = headers["retry-after"] ?? headers["Retry-After"];
      const retryAfterSeconds = retryAfterRaw ? Number.parseFloat(retryAfterRaw) : undefined;
      return new AnthropicRateLimitError(
        `Anthropic rate limit (429): ${err.message}`,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      );
    }
    if (status >= 500 && status < 600) {
      return new AnthropicServerError(`Anthropic server error (${status}): ${err.message}`, status);
    }
    return new AnthropicBadRequestError(`Anthropic API error (${status}): ${err.message}`);
  }

  // AbortError / DOMException AbortError / timeout via AbortSignal.timeout.
  if (err instanceof Error) {
    if (err.name === "AbortError" || /aborted|timeout|ETIMEDOUT/i.test(err.message)) {
      return new AnthropicTimeoutError(`Anthropic request timeout: ${err.message}`);
    }
    return new AnthropicTimeoutError(`Anthropic network error: ${err.message}`);
  }

  return new AnthropicTimeoutError(`Anthropic unknown error: ${String(err)}`);
}

type RetryDecision = { retry: boolean; delayMs: number };

function decideRetry(err: AnthropicError, retriesUsed: number): RetryDecision {
  if (!err.retryable) return { retry: false, delayMs: 0 };

  if (err instanceof AnthropicRateLimitError) {
    if (retriesUsed >= 1) return { retry: false, delayMs: 0 };
    const fromHeaderMs = err.retryAfterSeconds
      ? Math.round(err.retryAfterSeconds * 1000)
      : 0;
    const delayMs = fromHeaderMs > 0 ? fromHeaderMs : 1_000 + Math.floor(Math.random() * 250);
    return { retry: true, delayMs };
  }

  if (err instanceof AnthropicServerError) {
    // Up to FIVE_XX_MAX_ATTEMPTS attempts → up to (FIVE_XX_MAX_ATTEMPTS - 1) retries.
    if (retriesUsed >= FIVE_XX_MAX_ATTEMPTS - 1) return { retry: false, delayMs: 0 };
    const idx = Math.min(retriesUsed, RETRY_BACKOFF_MS.length - 1);
    return { retry: true, delayMs: RETRY_BACKOFF_MS[idx]! };
  }

  if (err instanceof AnthropicTimeoutError) {
    if (retriesUsed >= 1) return { retry: false, delayMs: 0 };
    return { retry: true, delayMs: 1_000 };
  }

  return { retry: false, delayMs: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
