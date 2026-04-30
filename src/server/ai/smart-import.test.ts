import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StubClaudeClient,
  __resetClaudeClientForTests,
} from "./claude-client";

/**
 * Tests for StubClaudeClient.structureItemsFromText (Phase 8c smart import).
 *
 * Per Gate-1 K4: tests assert FLOW not CONTENT — the stub's specific
 * output shape will diverge from real Claude. What we verify here:
 *
 *   1. Each call returns a non-empty array of drafts (≥3) with at least
 *      a name field on every item.
 *   2. Across 5 successive calls, the rotating-wrong-field cursor cycles:
 *      different items have different fields missing/wrong, so the
 *      operator-correction UI exercises every branch.
 *   3. Reserved spec keys (`_template_id`) never leak into the spec bag.
 *   4. Pattern matching produces recognizable items for common keywords
 *      (laptop / phone / router) — operators see plausible drafts.
 */

beforeEach(() => {
  __resetClaudeClientForTests();
});

afterEach(() => {
  __resetClaudeClientForTests();
});

describe("StubClaudeClient.structureItemsFromText — flow + rotation", () => {
  it("returns at least 3 drafts, each with a name", async () => {
    const c = new StubClaudeClient();
    const r = await c.structureItemsFromText!({
      text: "Macbook Pro M3, $2200, in stock",
    });
    expect(r.toolArgs.items.length).toBeGreaterThanOrEqual(3);
    for (const item of r.toolArgs.items) {
      expect(item.name).toBeTruthy();
    }
  });

  it("rotates the wrong field across successive calls", async () => {
    const c = new StubClaudeClient();
    // 5 calls cycle through all 5 wrong-field branches. Track which
    // specific field is missing on item[0] of each call.
    const wrongFields: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await c.structureItemsFromText!({ text: "macbook" });
      const first = r.toolArgs.items[0]!;
      // The rotation list cycles through: currency, availability, price,
      // brand, sku. We just check that NOT all calls have the same field
      // missing — that's enough to confirm rotation is active.
      const missing: string[] = [];
      if (!first.currency) missing.push("currency");
      if (!first.price) missing.push("price");
      if (!first.brand) missing.push("brand");
      if (!first.sku) missing.push("sku");
      // availability is set on every call (rotation maps it to "wrong"
      // value, not missing) — track the value instead.
      missing.push(`availability=${first.availability ?? "?"}`);
      wrongFields.push(missing.join(","));
    }
    // Across 5 calls there should be at least 3 distinct missing-field
    // patterns — exact 5 isn't guaranteed because availability rotation
    // doesn't change the missing-field shape, just its value.
    const distinct = new Set(wrongFields).size;
    expect(distinct).toBeGreaterThanOrEqual(3);
  });

  it("never leaks reserved _template_id into the specs bag", async () => {
    const c = new StubClaudeClient();
    for (let i = 0; i < 5; i++) {
      const r = await c.structureItemsFromText!({ text: "laptop" });
      for (const item of r.toolArgs.items) {
        if (!item.specs) continue;
        for (const k of Object.keys(item.specs)) {
          expect(k.startsWith("_")).toBe(false);
        }
      }
    }
  });

  it("pattern-matches keywords (laptop → Macbook draft)", async () => {
    const c = new StubClaudeClient();
    const r = await c.structureItemsFromText!({
      text: "I need to add some laptops",
    });
    const names = r.toolArgs.items.map((it) => it.name);
    expect(names.some((n) => /macbook/i.test(n))).toBe(true);
  });

  it("falls through to generic Sample Product N when no keywords match", async () => {
    const c = new StubClaudeClient();
    const r = await c.structureItemsFromText!({
      text: "lorem ipsum dolor sit amet",
    });
    const names = r.toolArgs.items.map((it) => it.name);
    // At least one generic "Sample Product N" entry should be present.
    expect(names.some((n) => /Sample Product/i.test(n))).toBe(true);
  });

  it("returns notes alongside the drafts envelope", async () => {
    const c = new StubClaudeClient();
    const r = await c.structureItemsFromText!({ text: "anything" });
    expect(r.toolArgs.notes).toBeTruthy();
    expect(r.modelId).toBe("stub");
  });
});
