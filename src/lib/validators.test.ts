import { describe, expect, it } from "vitest";
import {
  AI_BEHAVIOR_DEFAULTS,
  aiBehaviorSchema,
  defaultVoiceProfile,
  getAiBehaviorForTenant,
  getVoiceProfile,
  isBlocklistedPassword,
  passwordSchema,
  voiceProfileSchema,
} from "./validators";

describe("voice profile", () => {
  it("default profile is fully populated", () => {
    const p = defaultVoiceProfile();
    expect(p.tone).toBe("friendly");
    expect(p.formality).toBe(3);
    expect(p.emojiPolicy).toBe("minimal");
    expect(p.defaultLanguage).toBe("fr");
    expect(p.fallbackLanguage).toBe("en");
    expect(p.signaturePhrases).toEqual([]);
    expect(p.avoid).toEqual([]);
    expect(p.fewShot).toEqual([]);
  });

  it("rejects out-of-range formality", () => {
    expect(() => voiceProfileSchema.parse({ formality: 0 })).toThrow();
    expect(() => voiceProfileSchema.parse({ formality: 6 })).toThrow();
    expect(() => voiceProfileSchema.parse({ formality: 2.5 })).toThrow();
  });

  it("rejects unknown tone / language / emoji policy", () => {
    expect(() => voiceProfileSchema.parse({ tone: "snarky" })).toThrow();
    expect(() => voiceProfileSchema.parse({ defaultLanguage: "es" })).toThrow();
    expect(() => voiceProfileSchema.parse({ emojiPolicy: "many" })).toThrow();
  });

  it("caps few-shot examples at 20 and signature phrases at 10", () => {
    const tooManyShots = Array.from({ length: 21 }, () => ({
      customer: "hi",
      reply: "hello",
    }));
    expect(() => voiceProfileSchema.parse({ fewShot: tooManyShots })).toThrow();

    const tooManyPhrases = Array.from({ length: 11 }, (_, i) => `phrase ${i}`);
    expect(() =>
      voiceProfileSchema.parse({ signaturePhrases: tooManyPhrases }),
    ).toThrow();
  });
});

describe("getVoiceProfile()", () => {
  it("returns the stored profile when settings is well-formed", () => {
    const p = getVoiceProfile({
      voiceProfile: { tone: "formal", formality: 5, fallbackLanguage: "ar" },
    });
    expect(p.tone).toBe("formal");
    expect(p.formality).toBe(5);
    expect(p.fallbackLanguage).toBe("ar");
    // Unspecified fields fall back to defaults.
    expect(p.emojiPolicy).toBe("minimal");
  });

  it("falls back to default when settings is null / undefined / malformed", () => {
    expect(getVoiceProfile(null).tone).toBe("friendly");
    expect(getVoiceProfile(undefined).tone).toBe("friendly");
    expect(getVoiceProfile("not an object").tone).toBe("friendly");
    // settings is an object but voiceProfile field is bad shape → default.
    expect(getVoiceProfile({ voiceProfile: { tone: "snarky" } }).tone).toBe(
      "friendly",
    );
  });

  it("preserves legacy settings fields via passthrough on parse", () => {
    // Just verifying we don't throw on legacy seeds with brandVoice etc.
    const p = getVoiceProfile({
      defaultLanguage: "en",
      brandVoice: "friendly-professional",
      businessHours: { tz: "Africa/Algiers" },
    });
    expect(p.tone).toBe("friendly"); // no voiceProfile field → default
  });
});

describe("aiBehaviorSchema", () => {
  it("parses a fully-specified object verbatim", () => {
    const parsed = aiBehaviorSchema.parse({
      showPrices: true,
      showStockCounts: true,
      requireHumanForOrders: false,
    });
    expect(parsed).toEqual({
      showPrices: true,
      showStockCounts: true,
      requireHumanForOrders: false,
    });
  });

  it("fills defaults for missing fields", () => {
    expect(aiBehaviorSchema.parse({})).toEqual(AI_BEHAVIOR_DEFAULTS);
    expect(aiBehaviorSchema.parse({ showPrices: true })).toEqual({
      showPrices: true,
      showStockCounts: false,
      requireHumanForOrders: true,
    });
  });

  it("rejects non-boolean values for any toggle", () => {
    expect(() =>
      aiBehaviorSchema.parse({ showPrices: "yes" }),
    ).toThrow();
    expect(() =>
      aiBehaviorSchema.parse({ showStockCounts: 1 }),
    ).toThrow();
    expect(() =>
      aiBehaviorSchema.parse({ requireHumanForOrders: null }),
    ).toThrow();
  });

  it("AI_BEHAVIOR_DEFAULTS matches the platform default contract", () => {
    expect(AI_BEHAVIOR_DEFAULTS).toEqual({
      showPrices: false,
      showStockCounts: false,
      requireHumanForOrders: true,
    });
  });
});

describe("getAiBehaviorForTenant()", () => {
  it("returns the platform defaults when settings has no aiBehavior key", () => {
    expect(getAiBehaviorForTenant({})).toEqual(AI_BEHAVIOR_DEFAULTS);
  });

  it("merges per-toggle overrides with defaults for unspecified fields", () => {
    expect(
      getAiBehaviorForTenant({
        aiBehavior: { showPrices: true },
      }),
    ).toEqual({
      showPrices: true,
      showStockCounts: false,
      requireHumanForOrders: true,
    });
  });

  it("returns defaults for null / undefined / non-object settings", () => {
    expect(getAiBehaviorForTenant(null)).toEqual(AI_BEHAVIOR_DEFAULTS);
    expect(getAiBehaviorForTenant(undefined)).toEqual(AI_BEHAVIOR_DEFAULTS);
    expect(getAiBehaviorForTenant("not an object")).toEqual(
      AI_BEHAVIOR_DEFAULTS,
    );
  });

  it("returns defaults when aiBehavior is malformed", () => {
    expect(
      getAiBehaviorForTenant({ aiBehavior: { showPrices: "yes" } }),
    ).toEqual(AI_BEHAVIOR_DEFAULTS);
  });

  it("never returns the frozen defaults object reference (caller may mutate)", () => {
    const result = getAiBehaviorForTenant({});
    expect(result).not.toBe(AI_BEHAVIOR_DEFAULTS);
    // Mutating the returned object must not poison the shared defaults.
    result.showPrices = true;
    expect(AI_BEHAVIOR_DEFAULTS.showPrices).toBe(false);
  });

  it("co-exists with voiceProfile in the same settings object", () => {
    const settings = {
      voiceProfile: { tone: "formal" as const },
      aiBehavior: { requireHumanForOrders: false },
    };
    expect(getAiBehaviorForTenant(settings)).toEqual({
      showPrices: false,
      showStockCounts: false,
      requireHumanForOrders: false,
    });
    expect(getVoiceProfile(settings).tone).toBe("formal");
  });
});

describe("passwordSchema", () => {
  it("accepts a password meeting all rules (8+ chars, letter + digit, not common)", () => {
    expect(passwordSchema.safeParse("abc123ab").success).toBe(true);
    // Long passphrases pass — no upper bound on length.
    expect(
      passwordSchema.safeParse("correct horse battery staple 9").success,
    ).toBe(true);
  });

  it("rejects passwords shorter than 8 characters", () => {
    const r = passwordSchema.safeParse("abc1");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/at least 8/);
    }
  });

  it("rejects passwords with no digit", () => {
    const r = passwordSchema.safeParse("abcdefgh");
    expect(r.success).toBe(false);
  });

  it("rejects passwords with no letter (and that are also in the blocklist)", () => {
    const r = passwordSchema.safeParse("12345678");
    expect(r.success).toBe(false);
  });

  it("rejects common-password substrings even when length / digit rules pass", () => {
    // "Password1" satisfies length + letter + digit but contains the
    // blocklisted substring "password" (case-insensitive).
    expect(passwordSchema.safeParse("Password1").success).toBe(false);
    expect(passwordSchema.safeParse("qwerty1234").success).toBe(false);
    expect(passwordSchema.safeParse("Letmein99").success).toBe(false);
  });
});

describe("isBlocklistedPassword", () => {
  it("case-insensitive substring match against the blocklist", () => {
    expect(isBlocklistedPassword("password")).toBe(true);
    expect(isBlocklistedPassword("PaSsWoRd")).toBe(true);
    expect(isBlocklistedPassword("xPassword1")).toBe(true);
  });

  it("returns false for strings that don't contain any blocklisted entry", () => {
    expect(isBlocklistedPassword("zephyr-melody-83")).toBe(false);
    expect(isBlocklistedPassword("abc123ab")).toBe(false);
  });
});
