import { describe, expect, it } from "vitest";
import {
  computeCostUsd,
  formatUsd,
  getPricing,
  type UsageBreakdown,
} from "./pricing";

describe("getPricing — model lookup", () => {
  it("resolves the alias for Sonnet 4.6", () => {
    const p = getPricing("claude-sonnet-4-6");
    expect(p.input).toBe(3.0);
    expect(p.output).toBe(15.0);
  });

  it("falls back to family alias when given a dated snapshot", () => {
    // No `claude-sonnet-4-6-20260217` row in the table — should strip
    // the suffix and resolve to `claude-sonnet-4-6`.
    const p = getPricing("claude-sonnet-4-6-20260217");
    expect(p.input).toBe(3.0);
    expect(p.output).toBe(15.0);
  });

  it("resolves dated Sonnet 4.5 snapshot via family fallback", () => {
    const direct = getPricing("claude-sonnet-4-5");
    const dated = getPricing("claude-sonnet-4-5-20250929");
    expect(dated).toEqual(direct);
  });

  it("throws loudly on unregistered models", () => {
    expect(() => getPricing("claude-future-9-9")).toThrow(/no pricing registered/);
  });

  it("haiku and opus families are pre-registered", () => {
    expect(getPricing("claude-haiku-4-5").input).toBe(1.0);
    expect(getPricing("claude-opus-4-7").input).toBe(15.0);
  });
});

describe("computeCostUsd — math", () => {
  it("plain input + output, no caching", () => {
    // 1000 input tokens @ $3/M, 500 output @ $15/M
    // = 0.001 * 3 + 0.0005 * 15 = 0.003 + 0.0075 = 0.0105
    const cost = computeCostUsd("claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("includes cache-write surcharge (5-min TTL)", () => {
    // 1000 input @ $3/M + 500 output @ $15/M + 800 cache-write @ $3.75/M
    // = 0.003 + 0.0075 + 0.003 = 0.0135
    const cost = computeCostUsd("claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 800,
    });
    expect(cost).toBeCloseTo(0.0135, 6);
  });

  it("applies the 90% cache-read discount", () => {
    // 100 plain input @ $3/M + 500 output @ $15/M + 700 cache-read @ $0.30/M
    // = 0.0003 + 0.0075 + 0.00021 = 0.00801
    const cost = computeCostUsd("claude-sonnet-4-6", {
      inputTokens: 100,
      outputTokens: 500,
      cacheReadInputTokens: 700,
    });
    expect(cost).toBeCloseTo(0.00801, 6);
  });

  it("realistic mixed-cache scenario shows the savings vs all-uncached", () => {
    // Simulate Block A + Block B cached on second call.
    // Real: 50 input + 400 output + 750 cache-read.
    // = 50 * 3/M + 400 * 15/M + 750 * 0.3/M = 0.00015 + 0.006 + 0.000225 = 0.006375
    const cached: UsageBreakdown = {
      inputTokens: 50,
      outputTokens: 400,
      cacheReadInputTokens: 750,
    };
    const uncached: UsageBreakdown = {
      inputTokens: 800, // would-be plain if no caching
      outputTokens: 400,
    };
    const cachedCost = computeCostUsd("claude-sonnet-4-6", cached);
    const uncachedCost = computeCostUsd("claude-sonnet-4-6", uncached);
    // Caching produces meaningfully cheaper cost.
    expect(cachedCost).toBeLessThan(uncachedCost);
    // Sanity: cached path saves at least 30% of input cost on this shape.
    const inputCostCached = (50 * 3) / 1_000_000 + (750 * 0.3) / 1_000_000;
    const inputCostUncached = (800 * 3) / 1_000_000;
    expect(inputCostCached).toBeLessThan(inputCostUncached * 0.5);
  });

  it("zero usage returns zero cost", () => {
    expect(
      computeCostUsd("claude-sonnet-4-6", { inputTokens: 0, outputTokens: 0 }),
    ).toBe(0);
  });
});

describe("formatUsd", () => {
  it("formats six decimals for sub-cent precision", () => {
    expect(formatUsd(0.0105)).toBe("$0.010500");
    expect(formatUsd(0)).toBe("$0.000000");
    expect(formatUsd(1.23456789)).toBe("$1.234568");
  });
});
