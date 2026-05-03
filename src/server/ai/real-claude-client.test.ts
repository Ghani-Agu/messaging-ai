import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * RealClaudeClient unit tests. The Anthropic SDK is mocked at the module
 * level so the retry loop, error classification, and tool_use parsing
 * can be exercised deterministically without real API calls.
 *
 * What we DON'T test here (covered elsewhere or deferred):
 *   - Streaming (P4r-4).
 *   - structureItemsFromText (P4r-5).
 *   - Prompt-cache header wiring (P4r-3).
 *   - Conversation-level retry budget (lives in the orchestrator,
 *     covered by orchestrator.test.ts).
 *   - Brain-cost log line content (orchestrator-level).
 */

// Module-level mock state, shared between every test in this file.
// `mockCreate` is the SDK's `messages.create` — tests call
// .mockResolvedValueOnce / .mockRejectedValueOnce to script behavior.
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  /**
   * Mock for the SDK's APIError class. The real client narrows on
   * `instanceof APIError` and reads `status` + `headers`. Both are
   * exposed here exactly as the real SDK does — anything more is
   * over-fitting the mock.
   */
  class MockAPIError extends Error {
    status: number;
    headers: Record<string, string>;
    constructor(opts: {
      status: number;
      message: string;
      headers?: Record<string, string>;
    }) {
      super(opts.message);
      this.name = "APIError";
      this.status = opts.status;
      this.headers = opts.headers ?? {};
    }
  }
  class MockAnthropic {
    messages = { create: mockCreate };
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic, APIError: MockAPIError };
});

// Imported AFTER the mock so the real client picks up the mocked SDK.
const { RealClaudeClient } = await import("./real-claude-client");
const { APIError } = (await import("@anthropic-ai/sdk")) as unknown as {
  APIError: new (opts: {
    status: number;
    message: string;
    headers?: Record<string, string>;
  }) => Error;
};

const SAMPLE_SEND_REPLY_ARGS = {
  system: [{ type: "text" as const, text: "block A" }, { type: "text" as const, text: "block B" }],
  userMessage: "What are your shipping options?",
  maxTokens: 600,
};

function makeToolUseResponse(overrides?: {
  reply?: string;
  language?: "en" | "fr" | "ar" | "darija";
  groundedness?: number;
  citationsUsed?: number[];
  escalation?: boolean;
  escalationReason?:
    | "LOW_CONFIDENCE"
    | "NEGATIVE_SENTIMENT"
    | "EXPLICIT_REQUEST"
    | "OUTSIDE_SCOPE"
    | "PAYMENT_DISPUTE";
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  model?: string;
}) {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: overrides?.model ?? "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use" as const,
        id: "toolu_x",
        name: "send_reply",
        input: {
          reply: overrides?.reply ?? "Hello from the test.",
          language: overrides?.language ?? "en",
          groundedness: overrides?.groundedness ?? 0.85,
          citations_used: overrides?.citationsUsed ?? [1],
          escalation_recommended: overrides?.escalation ?? false,
          ...(overrides?.escalationReason
            ? { escalation_reason: overrides.escalationReason }
            : {}),
        },
      },
    ],
    usage: {
      input_tokens: overrides?.inputTokens ?? 200,
      output_tokens: overrides?.outputTokens ?? 50,
      cache_creation_input_tokens: overrides?.cacheCreationInputTokens ?? null,
      cache_read_input_tokens: overrides?.cacheReadInputTokens ?? null,
    },
  };
}

function makeRefusalResponse() {
  // end_turn with no tool_use block — the refusal pattern.
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text" as const, text: "I cannot help with that." }],
    usage: { input_tokens: 200, output_tokens: 12 },
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RealClaudeClient.sendReply — happy path", () => {
  it("returns a SendReplyResult mapped from the tool_use block", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({
        reply: "We ship across Algeria in 2-3 days.",
        language: "en",
        groundedness: 0.9,
        citationsUsed: [1, 2],
        inputTokens: 1200,
        outputTokens: 80,
      }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const r = await c.sendReply(SAMPLE_SEND_REPLY_ARGS);

    expect(r.modelId).toBe("claude-sonnet-4-6");
    expect(r.toolArgs.reply).toBe("We ship across Algeria in 2-3 days.");
    expect(r.toolArgs.language).toBe("en");
    expect(r.toolArgs.groundedness).toBe(0.9);
    expect(r.toolArgs.citations_used).toEqual([1, 2]);
    expect(r.toolArgs.escalation_recommended).toBe(false);
    expect(r.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 80,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
    });
    expect(r.retriesUsed).toBe(0);
  });

  it("populates cache_creation/cache_read when present", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({
        cacheCreationInputTokens: 800,
        cacheReadInputTokens: 0,
      }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const r = await c.sendReply(SAMPLE_SEND_REPLY_ARGS);
    expect(r.usage?.cacheCreationInputTokens).toBe(800);
    expect(r.usage?.cacheReadInputTokens).toBe(0);
  });

  it("forces tool_use with the send_reply tool", async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await c.sendReply(SAMPLE_SEND_REPLY_ARGS);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0]![0]!;
    expect(callArg.tool_choice).toEqual({ type: "tool", name: "send_reply" });
    expect(callArg.tools[0].name).toBe("send_reply");
    expect(callArg.temperature).toBe(0.6);
    expect(callArg.max_tokens).toBe(600);
    // System blocks pass through as text-typed entries.
    expect(callArg.system).toEqual([
      { type: "text", text: "block A" },
      { type: "text", text: "block B" },
    ]);
  });
});

describe("RealClaudeClient.sendReply — tool refusal", () => {
  it("throws AnthropicToolRefusalError when end_turn has no tool_use", async () => {
    mockCreate.mockResolvedValueOnce(makeRefusalResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await expect(c.sendReply(SAMPLE_SEND_REPLY_ARGS)).rejects.toBeInstanceOf(
      AnthropicToolRefusalError,
    );
  });

  it("does NOT retry on tool refusal", async () => {
    mockCreate.mockResolvedValueOnce(makeRefusalResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await expect(c.sendReply(SAMPLE_SEND_REPLY_ARGS)).rejects.toBeInstanceOf(
      AnthropicToolRefusalError,
    );
    expect(mockCreate).toHaveBeenCalledOnce();
  });
});

describe("RealClaudeClient.sendReply — error mapping (no retry)", () => {
  it("401 → AnthropicAuthError, no retry", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIError({ status: 401, message: "invalid api key" }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-bad" });
    await expect(c.sendReply(SAMPLE_SEND_REPLY_ARGS)).rejects.toBeInstanceOf(
      AnthropicAuthError,
    );
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("403 → AnthropicAuthError, no retry", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIError({ status: 403, message: "forbidden" }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await expect(c.sendReply(SAMPLE_SEND_REPLY_ARGS)).rejects.toBeInstanceOf(
      AnthropicAuthError,
    );
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("400 → AnthropicBadRequestError, no retry", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIError({ status: 400, message: "schema invalid" }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await expect(c.sendReply(SAMPLE_SEND_REPLY_ARGS)).rejects.toBeInstanceOf(
      AnthropicBadRequestError,
    );
    expect(mockCreate).toHaveBeenCalledOnce();
  });
});

describe("RealClaudeClient.sendReply — error mapping (retry)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("429 retries once then succeeds", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIError({
        status: 429,
        message: "rate limit",
        headers: { "retry-after": "0.5" },
      }),
    );
    mockCreate.mockResolvedValueOnce(makeToolUseResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.sendReply(SAMPLE_SEND_REPLY_ARGS);
    // Advance the retry-after delay (500ms).
    await vi.advanceTimersByTimeAsync(600);
    const r = await promise;
    expect(r.retriesUsed).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("429 persistent → AnthropicRateLimitError after one retry", async () => {
    mockCreate.mockRejectedValue(
      new APIError({
        status: 429,
        message: "rate limit",
        headers: { "retry-after": "0.1" },
      }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.sendReply(SAMPLE_SEND_REPLY_ARGS).catch((e) => e);
    await vi.advanceTimersByTimeAsync(500);
    const e = (await promise) as AnthropicRateLimitError;
    expect(e).toBeInstanceOf(AnthropicRateLimitError);
    expect(e.retriesUsed).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("500 retries up to 3 attempts (2 retries) then throws AnthropicServerError", async () => {
    mockCreate.mockRejectedValue(
      new APIError({ status: 500, message: "internal" }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.sendReply(SAMPLE_SEND_REPLY_ARGS).catch((e) => e);
    // Backoff: 500ms, then 2s. Two retries → three attempts total.
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(2_500);
    const e = (await promise) as AnthropicServerError;
    expect(e).toBeInstanceOf(AnthropicServerError);
    expect(e.retriesUsed).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("503 then 200 succeeds with retriesUsed=1", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIError({ status: 503, message: "service unavailable" }),
    );
    mockCreate.mockResolvedValueOnce(makeToolUseResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.sendReply(SAMPLE_SEND_REPLY_ARGS);
    await vi.advanceTimersByTimeAsync(600);
    const r = await promise;
    expect(r.retriesUsed).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("network/timeout error retries once", async () => {
    const abortErr = new Error("AbortError: signal aborted");
    abortErr.name = "AbortError";
    mockCreate.mockRejectedValueOnce(abortErr);
    mockCreate.mockResolvedValueOnce(makeToolUseResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.sendReply(SAMPLE_SEND_REPLY_ARGS);
    await vi.advanceTimersByTimeAsync(1_500);
    const r = await promise;
    expect(r.retriesUsed).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("persistent network error → AnthropicTimeoutError after one retry", async () => {
    const abortErr = new Error("AbortError");
    abortErr.name = "AbortError";
    mockCreate.mockRejectedValue(abortErr);
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.sendReply(SAMPLE_SEND_REPLY_ARGS).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1_500);
    const e = (await promise) as AnthropicTimeoutError;
    expect(e).toBeInstanceOf(AnthropicTimeoutError);
    expect(e.retriesUsed).toBe(1);
  });
});

describe("AnthropicError.retriesUsed propagates to thrown errors", () => {
  it("retriesUsed reflects how many retries the failing call made", async () => {
    mockCreate.mockRejectedValue(
      new APIError({ status: 500, message: "internal" }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.sendReply(SAMPLE_SEND_REPLY_ARGS).catch((e) => e);
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(2_500);
    const e = (await promise) as AnthropicError;
    expect(e).toBeInstanceOf(AnthropicError);
    expect(e.retriesUsed).toBe(2);
  });
});
