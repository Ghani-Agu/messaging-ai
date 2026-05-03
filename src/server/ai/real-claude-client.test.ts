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
// `mockStream` is the SDK's `messages.stream` — returns a fake
// MessageStream whose `finalMessage()` resolves to whatever the test
// scripts.
const mockCreate = vi.fn();
const mockStream = vi.fn();

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
    messages = { create: mockCreate, stream: mockStream };
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

/**
 * P4r-2/P4r-4 single-tool design: the response contains a tool_use
 * block (the only block — Sonnet 4.6 forced tool_use is exclusive),
 * with the reply text inside the tool args.
 */
function makeFullResponse(overrides?: {
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
  // end_turn with neither text content nor tool_use — full refusal.
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [],
    usage: { input_tokens: 200, output_tokens: 0 },
  };
}

/**
 * Defensive: text content present but tool_use didn't fire. Rare in the
 * single-tool design (Sonnet 4.6 with forced tool_use shouldn't emit
 * text alongside), but the error path stays for unusual model behavior.
 */
function makeTextOnlyResponse(reply: string) {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text" as const, text: reply }],
    usage: { input_tokens: 200, output_tokens: 50 },
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockStream.mockReset();
});

/**
 * Mock factory for the SDK's MessageStream return value. We only call
 * `.finalMessage()` on it in production code, so the mock just needs
 * that method. Async-iterable stub is here for completeness — never
 * exercised by RealClaudeClient.
 */
function fakeMessageStream(finalOrThrow: unknown) {
  if (finalOrThrow instanceof Error) {
    return {
      async *[Symbol.asyncIterator]() {
        // no events
      },
      finalMessage: async () => {
        throw finalOrThrow;
      },
    };
  }
  return {
    async *[Symbol.asyncIterator]() {
      // No-op iterator — RealClaudeClient awaits finalMessage() instead.
    },
    finalMessage: async () => finalOrThrow,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RealClaudeClient.sendReply — happy path", () => {
  it("returns a SendReplyResult mapped from the tool_use block", async () => {
    mockCreate.mockResolvedValueOnce(
      makeFullResponse({
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
    // Single-tool design: reply lives in toolArgs.
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
      makeFullResponse({
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
    mockCreate.mockResolvedValueOnce(makeFullResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await c.sendReply(SAMPLE_SEND_REPLY_ARGS);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0]![0]!;
    expect(callArg.tool_choice).toEqual({ type: "tool", name: "send_reply" });
    expect(callArg.tools[0].name).toBe("send_reply");
    expect(callArg.temperature).toBe(0.6);
    expect(callArg.max_tokens).toBe(600);
    // Single-tool: reply field is part of the schema.
    expect(callArg.tools[0].input_schema.required).toContain("reply");
    expect(callArg.tools[0].input_schema.properties).toHaveProperty("reply");
  });

  it("threads cacheControl through to Anthropic's cache_control marker", async () => {
    mockCreate.mockResolvedValueOnce(makeFullResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await c.sendReply({
      system: [
        { type: "text", text: "Block A", cacheControl: "ephemeral" },
        { type: "text", text: "Block B", cacheControl: "ephemeral" },
      ],
      userMessage: "hi",
      maxTokens: 600,
    });
    const callArg = mockCreate.mock.calls[0]![0]!;
    expect(callArg.system).toEqual([
      { type: "text", text: "Block A", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Block B", cache_control: { type: "ephemeral" } },
    ]);
    // Tools array also marked.
    // P4r-5 cache adjustment: tools[] no longer carries cache_control.
    // Single cumulative breakpoint at end of Block B is what actually caches.
    expect(callArg.tools[0].cache_control).toBeUndefined();
  });

  it("omits cache_control when cacheControl is unset", async () => {
    mockCreate.mockResolvedValueOnce(makeFullResponse());
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await c.sendReply({
      system: [{ type: "text", text: "uncached" }],
      userMessage: "hi",
      maxTokens: 600,
    });
    const callArg = mockCreate.mock.calls[0]![0]!;
    expect(callArg.system[0]).toEqual({ type: "text", text: "uncached" });
  });
});

describe("RealClaudeClient.sendReply — schema-split error states", () => {
  it("text content present, tool_use missing → AnthropicMissingMetadataError", async () => {
    mockCreate.mockResolvedValueOnce(
      makeTextOnlyResponse("Reply text without metadata."),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const err = await c.sendReply(SAMPLE_SEND_REPLY_ARGS).catch((e) => e);
    const { AnthropicMissingMetadataError } = await import("./errors");
    expect(err).toBeInstanceOf(AnthropicMissingMetadataError);
    expect(err.replyText).toBe("Reply text without metadata.");
    expect(err.modelId).toBe("claude-sonnet-4-6");
    expect(err.usage?.inputTokens).toBe(200);
    expect(err.retriesUsed).toBe(0);
  });

  it("does NOT retry on missing metadata", async () => {
    mockCreate.mockResolvedValueOnce(makeTextOnlyResponse("partial"));
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await c.sendReply(SAMPLE_SEND_REPLY_ARGS).catch(() => undefined);
    expect(mockCreate).toHaveBeenCalledOnce();
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
    mockCreate.mockResolvedValueOnce(makeFullResponse());
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
    mockCreate.mockResolvedValueOnce(makeFullResponse());
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
    mockCreate.mockResolvedValueOnce(makeFullResponse());
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

// ─────────────────────────────────────────────────────────────────────────────
// P4r-5 — structureItemsFromText
// ─────────────────────────────────────────────────────────────────────────────

function makeStructureItemsResponse(
  items: Array<{ name: string; price?: string; brand?: string; sku?: string }>,
  notes?: string,
) {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use" as const,
        id: "toolu_x",
        name: "structure_items",
        input: { items, ...(notes ? { notes } : {}) },
      },
    ],
    usage: {
      input_tokens: 800,
      output_tokens: 250,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

describe("RealClaudeClient.structureItemsFromText — happy path", () => {
  it("returns a StructureItemsResult mapped from the tool_use block", async () => {
    mockCreate.mockResolvedValueOnce(
      makeStructureItemsResponse(
        [
          { name: "Macbook Pro M3", brand: "Apple", price: "2200.00" },
          { name: "iPhone 15", brand: "Apple", price: "799.00" },
        ],
        "extracted 2 items",
      ),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const r = await c.structureItemsFromText!({
      text: "Macbook Pro M3 - 2200, iPhone 15 - 799",
    });

    expect(r.modelId).toBe("claude-sonnet-4-6");
    expect(r.toolArgs.items).toHaveLength(2);
    expect(r.toolArgs.items[0]!.name).toBe("Macbook Pro M3");
    expect(r.toolArgs.notes).toBe("extracted 2 items");
    expect(r.retriesUsed).toBe(0);
    expect(r.usage?.inputTokens).toBe(800);
  });

  it("uses temperature 0.1, forced tool_use on structure_items, dedicated system prompt", async () => {
    mockCreate.mockResolvedValueOnce(
      makeStructureItemsResponse([{ name: "Sample" }]),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await c.structureItemsFromText!({ text: "Sample product" });

    const callArg = mockCreate.mock.calls[0]![0]!;
    expect(callArg.temperature).toBe(0.1);
    expect(callArg.tool_choice).toEqual({ type: "tool", name: "structure_items" });
    expect(callArg.tools[0].name).toBe("structure_items");
    // Dedicated smart-import system prompt — distinct from Block A.
    expect(callArg.system[0].text).toContain("catalog data structurer");
    expect(callArg.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("forwards maxItems to the user prompt", async () => {
    mockCreate.mockResolvedValueOnce(
      makeStructureItemsResponse([{ name: "Sample" }]),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    await c.structureItemsFromText!({ text: "Some catalog", maxItems: 5 });

    const userMessage = mockCreate.mock.calls[0]![0]!.messages[0]!.content;
    expect(userMessage).toContain("up to 5");
  });
});

describe("RealClaudeClient.structureItemsFromText — error states", () => {
  it("retries on 5xx then succeeds with retriesUsed > 0", async () => {
    vi.useFakeTimers();
    mockCreate.mockRejectedValueOnce(
      new APIError({ status: 500, message: "internal" }),
    );
    mockCreate.mockResolvedValueOnce(
      makeStructureItemsResponse([{ name: "Sample" }]),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const promise = c.structureItemsFromText!({ text: "x" });
    await vi.advanceTimersByTimeAsync(600);
    const r = await promise;
    expect(r.retriesUsed).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("401 → AnthropicAuthError, no retry", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIError({ status: 401, message: "invalid api key" }),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-bad" });
    await expect(
      c.structureItemsFromText!({ text: "anything" }),
    ).rejects.toBeInstanceOf(AnthropicAuthError);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("missing tool_use block → AnthropicToolRefusalError", async () => {
    // Response with no tool_use block — should never happen with forced
    // tool_use, but we throw cleanly if it does.
    mockCreate.mockResolvedValueOnce({
      id: "msg_x",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      stop_sequence: null,
      content: [],
      usage: { input_tokens: 100, output_tokens: 0 },
    });
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const { AnthropicToolRefusalError } = await import("./errors");
    await expect(
      c.structureItemsFromText!({ text: "anything" }),
    ).rejects.toBeInstanceOf(AnthropicToolRefusalError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P4r-4 — streamReply
// ─────────────────────────────────────────────────────────────────────────────

describe("RealClaudeClient.streamReply — happy path", () => {
  it("yields chunked deltas then a done event with the full result", async () => {
    mockStream.mockReturnValueOnce(
      fakeMessageStream(
        makeFullResponse({
          reply: "Hello world! How can I help you today?",
          language: "en",
          groundedness: 0.85,
          citationsUsed: [1],
          inputTokens: 1200,
          outputTokens: 80,
        }),
      ),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });

    const events: Array<
      | { type: "delta"; text: string }
      | { type: "done"; replyLen: number; modelId: string }
    > = [];
    for await (const event of c.streamReply(SAMPLE_SEND_REPLY_ARGS)) {
      if (event.type === "delta") events.push({ type: "delta", text: event.text });
      else
        events.push({
          type: "done",
          replyLen: event.result.toolArgs.reply.length,
          modelId: event.result.modelId,
        });
    }

    const deltaCount = events.filter((e) => e.type === "delta").length;
    const doneCount = events.filter((e) => e.type === "done").length;
    expect(doneCount).toBe(1);
    expect(deltaCount).toBeGreaterThan(0);

    // Reassembling the deltas reproduces the full reply.
    const reassembled = events
      .filter((e): e is { type: "delta"; text: string } => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(reassembled).toBe("Hello world! How can I help you today?");

    // Done event carries the full result (reply in toolArgs).
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
  });

  it("forwards the SDK signal to messages.stream", async () => {
    mockStream.mockReturnValueOnce(fakeMessageStream(makeFullResponse()));
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });

    const externalSignal = new AbortController().signal;
    const iter = c.streamReply(SAMPLE_SEND_REPLY_ARGS, { signal: externalSignal });
    // Drain to trigger the underlying call.
    for await (const _ of iter) {
      void _;
    }

    expect(mockStream).toHaveBeenCalledOnce();
    const callOpts = mockStream.mock.calls[0]![1]!;
    // The signal passed in is the union of timeout + external; we just
    // assert SOMETHING was passed.
    expect(callOpts.signal).toBeDefined();
    expect(typeof callOpts.signal.aborted).toBe("boolean");
  });
});

describe("RealClaudeClient.streamReply — error states", () => {
  it("throws AnthropicToolRefusalError when the response has no tool_use and no text", async () => {
    mockStream.mockReturnValueOnce(fakeMessageStream(makeRefusalResponse()));
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });

    let caught: unknown;
    try {
      for await (const _ of c.streamReply(SAMPLE_SEND_REPLY_ARGS)) {
        void _;
      }
    } catch (err) {
      caught = err;
    }
    const { AnthropicToolRefusalError } = await import("./errors");
    expect(caught).toBeInstanceOf(AnthropicToolRefusalError);
  });

  it("throws AnthropicMissingMetadataError when text content arrives but tool_use is missing", async () => {
    mockStream.mockReturnValueOnce(
      fakeMessageStream(makeTextOnlyResponse("Reply text without metadata.")),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });

    let caught: unknown;
    try {
      for await (const _ of c.streamReply(SAMPLE_SEND_REPLY_ARGS)) {
        void _;
      }
    } catch (err) {
      caught = err;
    }
    const { AnthropicMissingMetadataError } = await import("./errors");
    expect(caught).toBeInstanceOf(AnthropicMissingMetadataError);
    expect((caught as InstanceType<typeof AnthropicMissingMetadataError>).replyText).toBe(
      "Reply text without metadata.",
    );
  });

  it("aborts mid-emit when the external signal fires after deltas have started", async () => {
    // Build a response with a sufficiently long reply that delta emission
    // takes multiple ticks; abort after the first delta.
    mockStream.mockReturnValueOnce(
      fakeMessageStream(
        makeFullResponse({
          reply: "x".repeat(200), // 200 codepoints → 25 chunks of 8 each
        }),
      ),
    );
    const c = new RealClaudeClient({ apiKey: "sk-ant-test" });
    const controller = new AbortController();

    let deltaCount = 0;
    let aborted = false;
    try {
      for await (const event of c.streamReply(SAMPLE_SEND_REPLY_ARGS, {
        signal: controller.signal,
      })) {
        if (event.type === "delta") {
          deltaCount += 1;
          if (deltaCount === 2) controller.abort();
        }
      }
    } catch (err) {
      const { AnthropicTimeoutError } = await import("./errors");
      if (err instanceof AnthropicTimeoutError) aborted = true;
    }
    expect(aborted).toBe(true);
    // We received some deltas before the abort, but not all 25.
    expect(deltaCount).toBeGreaterThanOrEqual(2);
    expect(deltaCount).toBeLessThan(25);
  });
});
