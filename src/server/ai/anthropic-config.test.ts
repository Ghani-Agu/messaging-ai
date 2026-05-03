import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_BASE_URL,
  ANTHROPIC_MODEL_DEFAULT,
  CONVERSATION_RETRY_CAP,
  REQUEST_TIMEOUT_MS,
  REQUEST_TOTAL_BUDGET_MS,
  resolveModelId,
} from "./anthropic-config";

describe("anthropic-config — constants", () => {
  it("default model is the Sonnet 4.6 alias", () => {
    expect(ANTHROPIC_MODEL_DEFAULT).toBe("claude-sonnet-4-6");
  });

  it("base URL points at Anthropic's API", () => {
    expect(ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
  });

  it("API version is pinned (not 'latest')", () => {
    expect(ANTHROPIC_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("request timeout is below total budget", () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(REQUEST_TOTAL_BUDGET_MS);
  });

  it("conversation retry cap is finite and small", () => {
    expect(CONVERSATION_RETRY_CAP).toBe(5);
  });
});

describe("resolveModelId — env override", () => {
  const original = process.env.ANTHROPIC_MODEL;

  beforeEach(() => {
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    if (original !== undefined) process.env.ANTHROPIC_MODEL = original;
    else delete process.env.ANTHROPIC_MODEL;
  });

  it("returns the default when env var is unset", () => {
    expect(resolveModelId()).toBe(ANTHROPIC_MODEL_DEFAULT);
  });

  it("returns the env value when set", () => {
    process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6-20260217";
    expect(resolveModelId()).toBe("claude-sonnet-4-6-20260217");
  });

  it("trims surrounding whitespace from env value", () => {
    process.env.ANTHROPIC_MODEL = "  claude-haiku-4-5  ";
    expect(resolveModelId()).toBe("claude-haiku-4-5");
  });

  it("falls back to default when env value is empty/whitespace", () => {
    process.env.ANTHROPIC_MODEL = "   ";
    expect(resolveModelId()).toBe(ANTHROPIC_MODEL_DEFAULT);
  });
});
