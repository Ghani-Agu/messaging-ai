import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetClaudeClientForTests,
  __setClaudeClientForTests,
  StubClaudeClient,
  getClaudeClient,
  type ClaudeClient,
  type SendReplyArgs,
  type SendReplyResult,
  type StructureItemsArgs,
  type StructureItemsResult,
} from "./claude-client";

/**
 * Tests for the getClaudeClient factory — focused on the test-isolation
 * guard (P4r-1 Gate-1 K9). The real client wiring lands in P4r-2; this
 * file exists to lock in the contract that:
 *
 *   1. Under VITEST=true (this test file's actual runtime), the factory
 *      always returns a stub — even with ANTHROPIC_API_KEY set.
 *   2. __setClaudeClientForTests injection takes precedence over the
 *      automatic resolution.
 *   3. __resetClaudeClientForTests clears the cache so subsequent calls
 *      pick up env changes.
 */

beforeEach(() => {
  __resetClaudeClientForTests();
});

afterEach(() => {
  __resetClaudeClientForTests();
});

describe("getClaudeClient — VITEST guard", () => {
  it("returns the stub under VITEST even when ANTHROPIC_API_KEY is set", () => {
    // Sanity: vitest sets this env var automatically when running the suite.
    expect(process.env.VITEST).toBe("true");

    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake-key-for-test-only";
    try {
      const client = getClaudeClient();
      expect(client).toBeInstanceOf(StubClaudeClient);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("returns the stub when ANTHROPIC_API_KEY is unset", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const client = getClaudeClient();
      expect(client).toBeInstanceOf(StubClaudeClient);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("caches the resolved client across calls", () => {
    const a = getClaudeClient();
    const b = getClaudeClient();
    expect(a).toBe(b);
  });
});

describe("__setClaudeClientForTests — injection", () => {
  // Minimal hand-rolled mock to verify injection wins over the automatic
  // resolution. Type-checks against the ClaudeClient interface so any
  // future contract change forces an update here.
  class RecordingMockClient implements ClaudeClient {
    sendReplyCalls = 0;
    structureItemsCalls = 0;

    async sendReply(_args: SendReplyArgs): Promise<SendReplyResult> {
      this.sendReplyCalls += 1;
      return {
        toolArgs: {
          reply: "mock",
          language: "en",
          groundedness: 1,
          citations_used: [],
          escalation_recommended: false,
        },
        modelId: "mock",
        usage: null,
        retriesUsed: 0,
      };
    }

    async structureItemsFromText(
      _args: StructureItemsArgs,
    ): Promise<StructureItemsResult> {
      this.structureItemsCalls += 1;
      return {
        toolArgs: { items: [{ name: "mock-item" }], notes: "mock" },
        modelId: "mock",
        usage: null,
        retriesUsed: 0,
      };
    }
  }

  it("injection takes precedence over automatic resolution", () => {
    const mock = new RecordingMockClient();
    __setClaudeClientForTests(mock);
    const client = getClaudeClient();
    expect(client).toBe(mock);
    expect(client).not.toBeInstanceOf(StubClaudeClient);
  });

  it("injected client receives sendReply calls", async () => {
    const mock = new RecordingMockClient();
    __setClaudeClientForTests(mock);
    const client = getClaudeClient();
    const r = await client.sendReply({
      system: [],
      userMessage: "hi",
      maxTokens: 10,
    });
    expect(r.modelId).toBe("mock");
    expect(mock.sendReplyCalls).toBe(1);
  });

  it("__resetClaudeClientForTests clears the injected client", () => {
    const mock = new RecordingMockClient();
    __setClaudeClientForTests(mock);
    expect(getClaudeClient()).toBe(mock);
    __resetClaudeClientForTests();
    const after = getClaudeClient();
    expect(after).toBeInstanceOf(StubClaudeClient);
    expect(after).not.toBe(mock);
  });
});
