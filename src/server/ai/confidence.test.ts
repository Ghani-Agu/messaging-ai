import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  computeConfidence,
  decideEscalation,
} from "./confidence";

describe("computeConfidence — happy paths", () => {
  it("perfect inputs return 0.9 (0.50 + 0.25 + 0.15)", () => {
    // 1.0 g + 1.0 sim + 3 citations, no escalation → exactly weights sum.
    const c = computeConfidence({
      groundedness: 1,
      topChunkSimilarity: 1,
      citationsUsedCount: 3,
      escalationRecommended: false,
    });
    expect(c).toBeCloseTo(0.9, 5);
  });

  it("zero inputs return 0", () => {
    const c = computeConfidence({
      groundedness: 0,
      topChunkSimilarity: 0,
      citationsUsedCount: 0,
      escalationRecommended: false,
    });
    expect(c).toBe(0);
  });
});

describe("computeConfidence — weights & saturation", () => {
  it("groundedness contributes 0.50 at the upper end", () => {
    const a = computeConfidence({
      groundedness: 0,
      topChunkSimilarity: 0,
      citationsUsedCount: 1,
      escalationRecommended: false,
    });
    const b = computeConfidence({
      groundedness: 1,
      topChunkSimilarity: 0,
      citationsUsedCount: 1,
      escalationRecommended: false,
    });
    expect(b - a).toBeCloseTo(0.5, 5);
  });

  it("topChunkSimilarity contributes 0.25", () => {
    const a = computeConfidence({
      groundedness: 0.5,
      topChunkSimilarity: 0,
      citationsUsedCount: 1,
      escalationRecommended: false,
    });
    const b = computeConfidence({
      groundedness: 0.5,
      topChunkSimilarity: 1,
      citationsUsedCount: 1,
      escalationRecommended: false,
    });
    expect(b - a).toBeCloseTo(0.25, 5);
  });

  it("citation count saturates at 3 (3 == 4 == 10)", () => {
    const base = {
      groundedness: 0.5,
      topChunkSimilarity: 0.5,
      escalationRecommended: false,
    };
    const c3 = computeConfidence({ ...base, citationsUsedCount: 3 });
    const c4 = computeConfidence({ ...base, citationsUsedCount: 4 });
    const c10 = computeConfidence({ ...base, citationsUsedCount: 10 });
    expect(c4).toBeCloseTo(c3, 5);
    expect(c10).toBeCloseTo(c3, 5);
  });

  it("citation count of 1 vs 3 differs by exactly 2/3 of the citation weight", () => {
    const base = {
      groundedness: 0.5,
      topChunkSimilarity: 0.5,
      escalationRecommended: false,
    };
    const c1 = computeConfidence({ ...base, citationsUsedCount: 1 });
    const c3 = computeConfidence({ ...base, citationsUsedCount: 3 });
    // saturation: 1/3 vs 3/3 of the 0.15 weight = 0.10 difference
    expect(c3 - c1).toBeCloseTo(0.1, 5);
  });
});

describe("computeConfidence — penalties", () => {
  it("escalation_recommended subtracts 0.30", () => {
    const base = {
      groundedness: 1,
      topChunkSimilarity: 1,
      citationsUsedCount: 3,
    };
    const noEsc = computeConfidence({ ...base, escalationRecommended: false });
    const withEsc = computeConfidence({ ...base, escalationRecommended: true });
    expect(noEsc - withEsc).toBeCloseTo(0.3, 5);
  });

  it("zero citations subtracts 0.20", () => {
    const a = computeConfidence({
      groundedness: 0.8,
      topChunkSimilarity: 0.5,
      citationsUsedCount: 1,
      escalationRecommended: false,
    });
    const b = computeConfidence({
      groundedness: 0.8,
      topChunkSimilarity: 0.5,
      citationsUsedCount: 0,
      escalationRecommended: false,
    });
    // Difference is the 0.20 zero-citation penalty plus the 1/3-of-0.15 =
    // 0.05 the 1-citation case earned. Net: 0.25.
    expect(a - b).toBeCloseTo(0.25, 5);
  });

  it("zero citations + escalation_recommended stack: no answer can clear threshold", () => {
    const c = computeConfidence({
      groundedness: 1,
      topChunkSimilarity: 1,
      citationsUsedCount: 0,
      escalationRecommended: true,
    });
    // 0.50 + 0.25 + 0 - 0.30 - 0.20 = 0.25
    expect(c).toBeCloseTo(0.25, 5);
    expect(c).toBeLessThan(CONFIDENCE_THRESHOLD);
  });
});

describe("computeConfidence — clamping & guards", () => {
  it("clamps to [0, 1] when inputs are out of range", () => {
    // Out-of-range positive inputs clamp to 1 internally; natural max of
    // the weight sum is 0.9 (perfect inputs, no penalty).
    expect(
      computeConfidence({
        groundedness: 5,
        topChunkSimilarity: 5,
        citationsUsedCount: 100,
        escalationRecommended: false,
      }),
    ).toBeCloseTo(0.9, 5);
    expect(
      computeConfidence({
        groundedness: -2,
        topChunkSimilarity: -2,
        citationsUsedCount: -5,
        escalationRecommended: true,
      }),
    ).toBe(0);
  });

  it("treats NaN groundedness as 0", () => {
    const c = computeConfidence({
      groundedness: Number.NaN,
      topChunkSimilarity: 1,
      citationsUsedCount: 3,
      escalationRecommended: false,
    });
    // 0 + 0.25 + 0.15 = 0.40
    expect(c).toBeCloseTo(0.4, 5);
  });

  it("rounds non-integer citation counts down", () => {
    const a = computeConfidence({
      groundedness: 0.5,
      topChunkSimilarity: 0.5,
      citationsUsedCount: 2.9,
      escalationRecommended: false,
    });
    const b = computeConfidence({
      groundedness: 0.5,
      topChunkSimilarity: 0.5,
      citationsUsedCount: 2,
      escalationRecommended: false,
    });
    expect(a).toBeCloseTo(b, 5);
  });
});

describe("decideEscalation", () => {
  it("forces LOW_CONFIDENCE below the threshold regardless of Claude", () => {
    expect(
      decideEscalation({
        confidence: 0.59,
        claudeRecommended: false,
        claudeReason: null,
      }),
    ).toBe("LOW_CONFIDENCE");
    expect(
      decideEscalation({
        confidence: 0.5,
        claudeRecommended: true,
        claudeReason: "PAYMENT_DISPUTE",
      }),
    ).toBe("LOW_CONFIDENCE");
  });

  it("honors Claude's reason above the threshold", () => {
    expect(
      decideEscalation({
        confidence: 0.85,
        claudeRecommended: true,
        claudeReason: "EXPLICIT_REQUEST",
      }),
    ).toBe("EXPLICIT_REQUEST");
  });

  it("returns null when confidence is fine and Claude didn't escalate", () => {
    expect(
      decideEscalation({
        confidence: 0.85,
        claudeRecommended: false,
        claudeReason: null,
      }),
    ).toBeNull();
  });

  it("returns null when Claude recommended but provided no reason (degenerate input)", () => {
    expect(
      decideEscalation({
        confidence: 0.85,
        claudeRecommended: true,
        claudeReason: null,
      }),
    ).toBeNull();
  });

  it("threshold boundary: 0.6 exactly does NOT trigger LOW_CONFIDENCE", () => {
    expect(
      decideEscalation({
        confidence: 0.6,
        claudeRecommended: false,
        claudeReason: null,
      }),
    ).toBeNull();
  });
});
