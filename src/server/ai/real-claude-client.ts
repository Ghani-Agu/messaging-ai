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
  StubClaudeClient,
  type ClaudeClient,
  type SendReplyArgs,
  type SendReplyResult,
  type SendReplyToolArgs,
  type StreamEvent,
  type StructureItemsArgs,
  type StructureItemsResult,
} from "./claude-client";
import {
  AnthropicAuthError,
  AnthropicBadRequestError,
  AnthropicError,
  AnthropicMissingMetadataError,
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

// Synthetic streaming pacing (P4r-4). Real per-token streaming doesn't
// work with forced tool_use (the schema-validation probe found Sonnet
// 4.6 emits the tool_use block exclusively), so streamReply runs the
// non-streaming SDK call underneath and chunks the resulting reply
// text with the same cadence the stub uses. Reasonable customer UX
// for 50–200 word support replies.
const STREAM_CHUNK_CODEPOINTS = 8;
const STREAM_INTER_CHUNK_DELAY_MS = 35;

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
   * Streaming variant (P4r-4). Uses the SDK's `messages.stream()` so the
   * upstream HTTP connection stays open for the full call and can be
   * cancelled via `opts.signal` (the widget route hooks this into
   * ReadableStream cancel — closing the customer's connection cancels
   * the upstream Anthropic call).
   *
   * Why call .stream() if we don't yield real per-token deltas? Two
   * reasons: (1) abort propagation to the upstream connection, (2) we
   * keep the streaming infrastructure wired in case a future model /
   * tool-choice combination supports text + tool together. The actual
   * customer-visible "streaming" is synthetic chunked pacing on the
   * complete reply text — see CLAUDE.md §7a for the rationale (forced
   * tool_use with Sonnet 4.6 is exclusive — no text content alongside).
   */
  async *streamReply(
    args: SendReplyArgs,
    opts?: { signal?: AbortSignal },
  ): AsyncGenerator<StreamEvent> {
    const result = await this.withRetry(async () =>
      this.consumeStream(args, opts?.signal),
    );

    // Phase 2: synthesize chunked deltas from the complete reply. Same
    // cadence as runBrainStream's stub fallback so the customer sees
    // a uniform UX regardless of which client is active.
    const reply = result.toolArgs.reply;
    const codepoints = [...reply];
    for (let i = 0; i < codepoints.length; i += STREAM_CHUNK_CODEPOINTS) {
      // External abort between chunks → stop emitting and throw.
      if (opts?.signal?.aborted) {
        const err = new AnthropicTimeoutError("stream cancelled by caller");
        err.retriesUsed = result.retriesUsed;
        throw err;
      }
      const chunk = codepoints
        .slice(i, i + STREAM_CHUNK_CODEPOINTS)
        .join("");
      yield { type: "delta", text: chunk };
      if (i + STREAM_CHUNK_CODEPOINTS < codepoints.length) {
        await sleep(STREAM_INTER_CHUNK_DELAY_MS);
      }
    }
    yield { type: "done", result };
  }

  /**
   * Open the SDK stream and await its complete final message. Returns
   * the same SendReplyResult shape as sendReplyOnce. Abort signal is
   * the union of the per-attempt timeout and any caller-provided
   * AbortSignal, so either firing cancels the upstream call.
   */
  private async consumeStream(
    args: SendReplyArgs,
    externalSignal: AbortSignal | undefined,
  ): Promise<SendReplyResult> {
    const systemBlocks = mapSystemBlocks(args.system);
    const tools = buildTools();
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = externalSignal
      ? AbortSignal.any([timeoutSignal, externalSignal])
      : timeoutSignal;

    try {
      const stream = this.client.messages.stream(
        {
          model: this.modelId,
          max_tokens: args.maxTokens,
          temperature: SEND_REPLY_TEMPERATURE,
          system: systemBlocks,
          tools,
          tool_choice: { type: "tool", name: SEND_REPLY_TOOL.name },
          messages: [{ role: "user", content: args.userMessage }],
        },
        { signal },
      );
      const finalMessage = await stream.finalMessage();
      return parseFinalMessage(finalMessage);
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  /**
   * Single attempt. Maps SDK errors to our typed errors so the retry
   * dispatcher can branch off `instanceof AnthropicError` without
   * cracking SDK internals.
   *
   * P4r-2/P4r-4 single-tool design (post-revert from P4r-3): with forced
   * tool_use, Sonnet 4.6 emits the tool_use block exclusively — never
   * text content alongside. Validated by `npm run probe:schema`. The
   * reply text lives back inside the tool args. Two error states:
   *   - no tool_use, no text content → AnthropicToolRefusalError
   *   - no tool_use, text content present → AnthropicMissingMetadataError
   *     (defensive — kept for unusual model behavior, expected to be rare).
   */
  private async sendReplyOnce(args: SendReplyArgs): Promise<SendReplyResult> {
    const systemBlocks = mapSystemBlocks(args.system);
    const tools = buildTools();
    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.modelId,
          max_tokens: args.maxTokens,
          temperature: SEND_REPLY_TEMPERATURE,
          system: systemBlocks,
          tools,
          tool_choice: { type: "tool", name: SEND_REPLY_TOOL.name },
          messages: [{ role: "user", content: args.userMessage }],
        },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (err) {
      throw mapSdkError(err);
    }

    return parseFinalMessage(response);
  }

  /**
   * P4r-3 → P4r-5 placeholder. Real smart-import wires the SDK call with
   * SEND_STRUCTURED_ITEMS_TOOL at temperature 0.1 in P4r-5; until then,
   * delegate to a private StubClaudeClient instance so the operator's
   * smart-import preview UI keeps working when ANTHROPIC_API_KEY is set.
   * Remove this delegation and replace with the actual SDK call in P4r-5.
   */
  private readonly p4r5SmartImportPlaceholder = new StubClaudeClient();

  async structureItemsFromText(args: StructureItemsArgs): Promise<StructureItemsResult> {
    return this.p4r5SmartImportPlaceholder.structureItemsFromText!(args);
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
  // P4r-3: pass cacheControl through as Anthropic's cache_control marker.
  // Each marker creates a separate prefix-cache breakpoint. With markers
  // on tools[] (set above), Block A, and Block B, we get:
  //   - cross-tenant hit on (tools + Block A) prefix
  //   - same-tenant hit on (tools + Block A + Block B) prefix
  return blocks.map((b) => ({
    type: "text" as const,
    text: b.text,
    ...(b.cacheControl
      ? { cache_control: { type: "ephemeral" as const } }
      : {}),
  }));
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

/**
 * Build the tools[] array for `messages.create` / `messages.stream`.
 * Marked with `cache_control: ephemeral` so the tool definition becomes
 * the first cache breakpoint (identical across all calls).
 */
function buildTools(): Anthropic.Messages.ToolUnion[] {
  const cache_control: Anthropic.Messages.CacheControlEphemeral = {
    type: "ephemeral",
  };
  const tool: Anthropic.Messages.Tool = {
    name: SEND_REPLY_TOOL.name,
    description: SEND_REPLY_TOOL.description,
    input_schema:
      SEND_REPLY_TOOL.input_schema as unknown as Anthropic.Messages.Tool.InputSchema,
    cache_control,
  };
  return [tool];
}

/**
 * Parse a complete Anthropic Message into a SendReplyResult, or throw
 * a typed AnthropicError for the failure paths.
 *
 * Single-tool design (P4r-4 post-revert): the reply is in the tool args.
 * Sonnet 4.6 with forced tool_use emits the tool_use block exclusively,
 * so a missing tool_use is the failure case.
 *
 *   - tool_use present              → happy path
 *   - no tool_use, text present     → AnthropicMissingMetadataError
 *                                     (defensive — rare)
 *   - no tool_use, no text          → AnthropicToolRefusalError
 *
 * `retriesUsed` is left at 0 here; withRetry overlays the real value
 * before returning to the caller.
 */
function parseFinalMessage(
  response: Anthropic.Messages.Message,
): SendReplyResult {
  const toolBlock = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock =>
      b.type === "tool_use" && b.name === SEND_REPLY_TOOL.name,
  );
  const replyText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const usage = response.usage;
  const mappedUsage = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
  };

  if (!toolBlock) {
    if (replyText) {
      throw new AnthropicMissingMetadataError({
        replyText,
        modelId: response.model,
        usage: mappedUsage,
      });
    }
    throw new AnthropicToolRefusalError();
  }

  const toolArgs = toolBlock.input as SendReplyToolArgs;
  return {
    toolArgs,
    modelId: response.model,
    usage: mappedUsage,
    retriesUsed: 0,
  };
}
